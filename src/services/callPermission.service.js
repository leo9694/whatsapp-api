const prisma = require("../database/prisma");
const contactRepository = require("../repositories/contact.repository");
const conversationRepository = require("../repositories/conversation.repository");
const permissionRepository = require("../repositories/callPermission.repository");
const socket = require("../sockets/socket");
const logger = require("../utils/logger");

function metaDate(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function actionAllowed(meta, actionName) {
  return meta?.actions?.find((item) => item?.action_name === actionName)?.can_perform_action === true;
}

function normalizeMeta(meta, existing, now = new Date()) {
  const rawStatus = String(meta?.permission?.status || "").trim().toLowerCase();
  const expiresAt = metaDate(meta?.permission?.expiration_time);
  const isPermanent = rawStatus === "permanent";
  const expired = Boolean(expiresAt && expiresAt <= now);
  const canStart = actionAllowed(meta, "start_call");
  let status;
  if (canStart && !expired) status = "GRANTED";
  else if (expired || rawStatus === "expired") status = "EXPIRED";
  else if (["temporary", "permanent", "granted"].includes(rawStatus)) status = "GRANTED";
  else if (rawStatus === "pending") status = "PENDING";
  else if (rawStatus === "revoked") status = "REVOKED";
  else if (rawStatus === "denied") status = "DENIED";
  else if (rawStatus === "no_permission" && existing?.status === "PENDING") status = "PENDING";
  else status = existing?.status === "GRANTED" && existing?.expiresAt && existing.expiresAt <= now
    ? "EXPIRED" : "DENIED";
  return {
    status,
    canStartCall: status === "GRANTED" && !expired && canStart,
    isPermanent,
    metaStatus: rawStatus || null,
    expiresAt: isPermanent ? null : expiresAt,
  };
}

function toDto(permission, now = new Date()) {
  if (!permission) {
    return {
      status: "DENIED", canCall: false, requestedAt: null,
      grantedAt: null, expiresAt: null,
    };
  }
  const expired = Boolean(permission.expiresAt && permission.expiresAt <= now);
  return {
    status: expired && permission.status === "GRANTED" ? "EXPIRED" : permission.status,
    canCall: permission.status === "GRANTED" && permission.canStartCall === true && !expired,
    requestedAt: permission.requestedAt?.toISOString?.() || permission.requestedAt || null,
    grantedAt: permission.grantedAt?.toISOString?.() || permission.grantedAt || null,
    deniedAt: permission.deniedAt?.toISOString?.() || permission.deniedAt || null,
    revokedAt: permission.revokedAt?.toISOString?.() || permission.revokedAt || null,
    expiresAt: permission.expiresAt?.toISOString?.() || permission.expiresAt || null,
    isPermanent: permission.isPermanent === true,
  };
}

function socketPayload(permission) {
  return {
    conversationId: permission.conversationId,
    contactId: permission.contactId,
    phoneNumberId: permission.phoneNumberId,
    ...toDto(permission),
  };
}

function emitUpdated(permission, conversation, dependencies = {}) {
  const socketServer = dependencies.socket || socket;
  const targets = [conversation?.assignedUserId, permission.requestedByAgentId].filter(Boolean);
  socketServer.emitToAgents(targets, "call:permission:updated", socketPayload(permission));
  logger.info("[CALL_PERMISSION] socket emitted", {
    conversationId: permission.conversationId,
    status: permission.status,
    targetCount: new Set(targets.map(String)).size,
  });
}

async function syncFromMeta({ conversation, phoneNumberId, meta, agent }, dependencies = {}) {
  const db = dependencies.db || prisma;
  const existing = await permissionRepository.find(conversation.id, phoneNumberId, db);
  const normalized = normalizeMeta(meta, existing);
  const now = new Date();
  const permission = await permissionRepository.upsert(conversation.id, phoneNumberId, {
    contactId: conversation.contactId,
    ...normalized,
    ...(agent ? { requestedByAgentId: String(agent.id), requestedByAgentName: agent.name } : {}),
    ...(normalized.status === "GRANTED" && !existing?.grantedAt ? { grantedAt: now } : {}),
    ...(normalized.status === "EXPIRED" ? { canStartCall: false } : {}),
  }, db);
  return permission;
}

async function markRequested({ conversation, phoneNumberId, agent, messageId }, dependencies = {}) {
  const db = dependencies.db || prisma;
  const permission = await permissionRepository.upsert(conversation.id, phoneNumberId, {
    contactId: conversation.contactId,
    status: "PENDING",
    canStartCall: false,
    isPermanent: false,
    metaStatus: "pending",
    responseSource: null,
    requestedByAgentId: String(agent.id),
    requestedByAgentName: agent.name,
    requestedAt: new Date(),
    grantedAt: null,
    deniedAt: null,
    revokedAt: null,
    expiresAt: null,
    metaReference: messageId || null,
    lastWebhookWamid: null,
  }, db);
  emitUpdated(permission, conversation, dependencies);
  return permission;
}

function isPermissionReply(message) {
  return message?.type === "interactive"
    && message?.interactive?.type === "call_permission_reply"
    && Boolean(message?.interactive?.call_permission_reply);
}

async function resolveConversation({ message, contacts, phoneNumberId }, db) {
  const waId = String(message.from || "");
  const profile = contacts.find((item) => String(item?.wa_id || "") === waId) || contacts[0];
  const contact = await contactRepository.upsertByWaId({
    waId, phone: waId, profileName: profile?.profile?.name || null,
  }, db);
  let conversation = await conversationRepository.findOpenByContactId(contact.id, db);
  if (!conversation) conversation = await conversationRepository.createForContact(contact.id, db, phoneNumberId);
  else if (phoneNumberId && conversation.phoneNumberId !== phoneNumberId) {
    conversation = await conversationRepository.updatePhoneNumberId(conversation.id, phoneNumberId, db);
  }
  return { contact, conversation };
}

async function processWebhook({ message, contacts = [], phoneNumberId }, dependencies = {}) {
  if (!isPermissionReply(message) || !message.from || !phoneNumberId) {
    return { ignored: true, reason: "not_call_permission_reply" };
  }
  const db = dependencies.db || prisma;
  const duplicate = await permissionRepository.findByWebhookWamid(message.id, db);
  if (duplicate) return { duplicate: true, permission: duplicate };
  const reply = message.interactive.call_permission_reply;
  logger.info("[CALL_PERMISSION] webhook received", {
    messageId: message.id || null,
    phoneNumberId,
    response: reply.response || null,
    responseSource: reply.response_source || null,
  });
  const { conversation } = await resolveConversation({ message, contacts, phoneNumberId }, db);
  const existing = await permissionRepository.find(conversation.id, phoneNumberId, db);
  const eventAt = metaDate(message.timestamp) || new Date();
  const accepted = reply.response === "accept";
  const revoked = !accepted && reply.response_source === "automatic" && existing?.status === "GRANTED";
  const status = accepted ? "GRANTED" : revoked ? "REVOKED" : "DENIED";
  const expiresAt = reply.is_permanent === true ? null : metaDate(reply.expiration_timestamp);
  let permission;
  try {
    permission = await permissionRepository.upsert(conversation.id, phoneNumberId, {
      contactId: conversation.contactId,
      status,
      canStartCall: accepted && (!expiresAt || expiresAt > eventAt),
      isPermanent: reply.is_permanent === true,
      metaStatus: accepted ? (reply.is_permanent ? "permanent" : "temporary") : status.toLowerCase(),
      responseSource: reply.response_source || null,
      ...(accepted ? { grantedAt: eventAt, deniedAt: null, revokedAt: null } : {}),
      ...(!accepted ? { deniedAt: revoked ? null : eventAt, revokedAt: revoked ? eventAt : null } : {}),
      expiresAt,
      metaReference: message.context?.id || existing?.metaReference || null,
      lastWebhookWamid: message.id || null,
    }, db);
  } catch (error) {
    if (error?.code === "P2002" && message.id) {
      return { duplicate: true, permission: await permissionRepository.findByWebhookWamid(message.id, db) };
    }
    throw error;
  }
  if (accepted) {
    logger.info("[CALL_PERMISSION] granted", {
      conversationId: conversation.id,
      phoneNumberId,
      isPermanent: permission.isPermanent,
      expiresAt: permission.expiresAt?.toISOString?.() || null,
    });
  }
  emitUpdated(permission, conversation, dependencies);
  return { permission, conversation, duplicate: false };
}

async function expireIfNeeded(permission, dependencies = {}) {
  if (!permission || permission.status !== "GRANTED" || !permission.expiresAt || permission.expiresAt > new Date()) {
    return permission;
  }
  return permissionRepository.update(permission.id, { status: "EXPIRED", canStartCall: false }, dependencies.db || prisma);
}

module.exports = {
  actionAllowed, expireIfNeeded, isPermissionReply, markRequested, normalizeMeta,
  processWebhook, socketPayload, syncFromMeta, toDto,
};
