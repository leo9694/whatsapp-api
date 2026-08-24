const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const socket = require("../sockets/socket");
const callRepository = require("../repositories/call.repository");
const contactRepository = require("../repositories/contact.repository");
const conversationRepository = require("../repositories/conversation.repository");
const whatsappService = require("./whatsapp.service");
const signalStore = require("./callSignalStore");
const { toCallDto } = require("../utils/callDto");
const { toConversationDto } = require("../utils/conversationDto");

const CONTROLLABLE = new Set(["RINGING", "CONNECTING", "ACTIVE"]);

function parseTimestamp(value, fallback = new Date()) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : fallback;
}

function direction(value) {
  return value === "BUSINESS_INITIATED" ? "OUTBOUND" : "INBOUND";
}

function remotePhone(call, contacts, callDirection) {
  const contactPhone = contacts.find((item) => item?.wa_id)?.wa_id;
  if (contactPhone) return String(contactPhone);
  return String(callDirection === "INBOUND" ? call?.from || "" : call?.to || "") || null;
}

function endReason(value) {
  const error = Array.isArray(value?.errors) ? value.errors[0] : null;
  const reason = error?.error_data?.details || error?.message || value?.status || null;
  return reason ? String(reason).slice(0, 500) : null;
}

function eventName(status) {
  return {
    RINGING: "call:ringing",
    CONNECTING: "call:connecting",
    ACTIVE: "call:active",
    REJECTED: "call:rejected",
    FAILED: "call:failed",
    BUSY: "call:failed",
    MISSED: "call:ended",
    ENDED: "call:ended",
  }[status] || "call:updated";
}

function emitCall(call, { incoming = false, session } = {}) {
  const dto = toCallDto(call);
  if (incoming) socket.emit("call:incoming", dto);
  socket.emit(eventName(dto.status), dto);
  socket.emit("call:updated", dto);
  if (session?.sdp && session?.sdp_type) {
    socket.emit("call:signal", {
      callId: dto.callId,
      direction: dto.direction,
      session: { sdpType: session.sdp_type, sdp: session.sdp },
    });
  }
}

async function associateCall(call, contacts, phoneNumberId, db) {
  const callDirection = direction(call?.direction);
  const phone = remotePhone(call, contacts, callDirection);
  if (!phone) return { contact: null, conversation: null, remotePhone: null };
  const profile = contacts.find((item) => String(item?.wa_id || "") === phone) || contacts[0];
  const contact = await contactRepository.upsertByWaId({
    waId: phone,
    phone,
    profileName: profile?.profile?.name || null,
  }, db);
  let conversation = await conversationRepository.findOpenByContactId(contact.id, db);
  if (!conversation) conversation = await conversationRepository.createForContact(contact.id, db, phoneNumberId);
  else if (phoneNumberId && conversation.phoneNumberId !== phoneNumberId) {
    conversation = await conversationRepository.updatePhoneNumberId(conversation.id, phoneNumberId, db);
  }
  return { contact, conversation, remotePhone: phone };
}

async function processCallEvent({ call, contacts = [], phoneNumberId, errors = [] }, dependencies = {}) {
  const db = dependencies.db || prisma;
  if (!call?.id || !phoneNumberId) return { ignored: true, reason: "missing_call_identity" };
  if (!["connect", "terminate"].includes(call.event)) return { ignored: true, reason: "unsupported_call_event" };
  const existing = await callRepository.findByMetaCallId(call.id, db);
  const eventAt = parseTimestamp(call.timestamp);
  if (existing?.lastEventAt && existing.lastEventAt.getTime() === eventAt.getTime()
    && ((call.event === "connect" && ["RINGING", "CONNECTING"].includes(existing.status))
      || (call.event === "terminate" && ["ENDED", "MISSED", "FAILED", "REJECTED", "BUSY"].includes(existing.status)))) {
    return { duplicate: true, call: toCallDto(existing) };
  }

  let saved;
  if (call.event === "connect") {
    const callDirection = direction(call.direction);
    const association = existing || await db.$transaction((tx) => associateCall(call, contacts, phoneNumberId, tx));
    const data = {
      phoneNumberId,
      direction: callDirection,
      status: callDirection === "INBOUND" ? "RINGING" : "CONNECTING",
      remotePhone: existing?.remotePhone || association.remotePhone,
      conversationId: existing?.conversationId || association.conversation?.id || null,
      contactId: existing?.contactId || association.contact?.id || null,
      startedAt: existing?.startedAt || eventAt,
      lastEventAt: eventAt,
    };
    saved = existing
      ? await callRepository.update(call.id, data, db)
      : await callRepository.create({ metaCallId: call.id, ...data }, db);
    signalStore.setRemoteSession(call.id, call.session);
    emitCall(saved, { incoming: callDirection === "INBOUND", session: call.session });
  } else {
    const callDirection = existing?.direction || direction(call.direction);
    const association = existing || await db.$transaction((tx) => associateCall(call, contacts, phoneNumberId, tx));
    const metaStatus = String(call.status || "").toUpperCase();
    const answeredAt = call.start_time ? parseTimestamp(call.start_time) : existing?.answeredAt || null;
    const endedAt = call.end_time ? parseTimestamp(call.end_time) : eventAt;
    const reason = endReason({ ...call, errors });
    let status;
    if (existing?.status === "REJECTED") status = "REJECTED";
    else if (metaStatus === "FAILED") status = /busy/i.test(reason || "") ? "BUSY" : "FAILED";
    else status = answeredAt ? "ENDED" : "MISSED";
    const data = {
      phoneNumberId,
      direction: callDirection,
      status,
      remotePhone: existing?.remotePhone || association.remotePhone,
      conversationId: existing?.conversationId || association.conversation?.id || null,
      contactId: existing?.contactId || association.contact?.id || null,
      startedAt: existing?.startedAt || eventAt,
      answeredAt,
      endedAt,
      durationSeconds: Number.isInteger(call.duration)
        ? call.duration
        : answeredAt ? Math.max(0, Math.floor((endedAt - answeredAt) / 1000)) : null,
      endReason: reason,
      lastEventAt: eventAt,
    };
    saved = existing
      ? await callRepository.update(call.id, data, db)
      : await callRepository.create({ metaCallId: call.id, ...data }, db);
    signalStore.remove(call.id);
    emitCall(saved);
  }
  logger.info("whatsapp_call_event", {
    callId: call.id,
    phoneNumberId,
    callEvent: call.event,
    direction: saved.direction,
    status: saved.status,
  });
  return toCallDto(saved);
}

async function processCallStatus({ status, phoneNumberId }, dependencies = {}) {
  const db = dependencies.db || prisma;
  if (!status?.id || status?.type !== "call") return { ignored: true };
  const existing = await callRepository.findByMetaCallId(status.id, db);
  if (!existing) return { ignored: true, reason: "call_not_found" };
  const mapped = { RINGING: "RINGING", ACCEPTED: "ACTIVE", REJECTED: "REJECTED" }[String(status.status).toUpperCase()];
  if (!mapped) return { ignored: true, reason: "unsupported_call_status" };
  const eventAt = parseTimestamp(status.timestamp);
  if (existing.status === mapped && existing.lastEventAt?.getTime() === eventAt.getTime()) {
    return { duplicate: true, call: toCallDto(existing) };
  }
  const updated = await callRepository.update(status.id, {
    status: mapped,
    phoneNumberId: phoneNumberId || existing.phoneNumberId,
    ...(mapped === "ACTIVE" ? { answeredAt: existing.answeredAt || eventAt } : {}),
    ...(mapped === "REJECTED" ? { endedAt: eventAt, endReason: "REJECTED" } : {}),
    lastEventAt: eventAt,
  }, db);
  emitCall(updated);
  return toCallDto(updated);
}

async function getCallForControl(callId, agent, db) {
  const call = await callRepository.findByMetaCallId(callId, db);
  if (!call) throw new AppError("Chamada não encontrada.", 404);
  if (!agent?.id) throw new AppError("Identificação do atendente ausente.", 401);
  if (call.conversationId) {
    const conversation = await conversationRepository.findById(call.conversationId, db);
    if (conversation?.assignedUserId && String(conversation.assignedUserId) !== String(agent.id) && !agent.director) {
      throw new AppError(`Conversa em atendimento por ${conversation.assignedUserName || "outro atendente"}.`, 403);
    }
  }
  return call;
}

function assertState(call, allowed) {
  if (!allowed.includes(call.status)) throw new AppError(`A chamada não permite esta ação no estado ${call.status}.`, 409);
}

async function preAccept(callId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const call = await getCallForControl(callId, input.agent, db);
  if (call.direction !== "INBOUND") throw new AppError("Somente chamadas recebidas podem ser pré-aceitas.", 409);
  assertState(call, ["RINGING", "CONNECTING"]);
  await (dependencies.preAcceptCall || whatsappService.preAcceptCall)(call.phoneNumberId, callId, input.session.sdp);
  signalStore.setPreAcceptAnswer(callId, input.session.sdp);
  const updated = await callRepository.update(callId, { status: "CONNECTING" }, db);
  emitCall(updated);
  return toCallDto(updated);
}

async function accept(callId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const call = await getCallForControl(callId, input.agent, db);
  if (call.direction !== "INBOUND") throw new AppError("Somente chamadas recebidas podem ser aceitas.", 409);
  assertState(call, ["RINGING", "CONNECTING"]);
  if (!signalStore.matchesPreAcceptAnswer(callId, input.session.sdp)) {
    throw new AppError("O SDP deve ser o mesmo utilizado no pré-aceite.", 409);
  }
  await (dependencies.acceptCall || whatsappService.acceptCall)(call.phoneNumberId, callId, input.session.sdp);
  const now = new Date();
  const updated = await callRepository.update(callId, { status: "ACTIVE", answeredAt: call.answeredAt || now }, db);
  emitCall(updated);
  return toCallDto(updated);
}

async function reject(callId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const call = await getCallForControl(callId, input.agent, db);
  if (call.direction !== "INBOUND") throw new AppError("Somente chamadas recebidas podem ser recusadas.", 409);
  assertState(call, ["RINGING", "CONNECTING"]);
  await (dependencies.rejectCall || whatsappService.rejectCall)(call.phoneNumberId, callId);
  const updated = await callRepository.update(callId, {
    status: "REJECTED", endedAt: new Date(), endReason: "REJECTED",
  }, db);
  signalStore.remove(callId);
  emitCall(updated);
  return toCallDto(updated);
}

async function terminate(callId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const call = await getCallForControl(callId, input.agent, db);
  if (!CONTROLLABLE.has(call.status)) throw new AppError(`A chamada já está no estado ${call.status}.`, 409);
  await (dependencies.terminateCall || whatsappService.terminateCall)(call.phoneNumberId, callId);
  const endedAt = new Date();
  const updated = await callRepository.update(callId, {
    status: "ENDED",
    endedAt,
    durationSeconds: call.answeredAt ? Math.max(0, Math.floor((endedAt - call.answeredAt) / 1000)) : null,
    endReason: "TERMINATED_BY_BUSINESS",
  }, db);
  signalStore.remove(callId);
  emitCall(updated);
  return toCallDto(updated);
}

function dateRange(date) {
  if (!date) return {};
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  return { createdAt: { gte: start, lt: end } };
}

async function listCalls(filters, db = prisma) {
  const where = {
    ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...dateRange(filters.date),
  };
  const [items, total] = await callRepository.list({
    where, skip: (filters.page - 1) * filters.limit, take: filters.limit,
  }, db);
  return {
    data: items.map(toCallDto),
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

async function conversationForCalling(conversationId, agent, db) {
  const conversation = await conversationRepository.findById(conversationId, db);
  if (!conversation) throw new AppError("Conversa não encontrada.", 404);
  if (!agent?.id) throw new AppError("Identificação do atendente ausente.", 401);
  if (conversation.assignedUserId && String(conversation.assignedUserId) !== String(agent.id) && !agent.director) {
    throw new AppError(`Conversa em atendimento por ${conversation.assignedUserName || "outro atendente"}.`, 403);
  }
  const phoneNumberId = conversation.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!phoneNumberId) throw new AppError("Número empresarial não associado à conversa.", 409);
  return { conversation, phoneNumberId };
}

async function getPermission(conversationId, agent, dependencies = {}) {
  const db = dependencies.db || prisma;
  const { conversation, phoneNumberId } = await conversationForCalling(conversationId, agent, db);
  const permission = await (dependencies.getCallPermission || whatsappService.getCallPermission)(
    phoneNumberId, conversation.contact.waId,
  );
  return { phoneNumberId, ...permission };
}

async function requestPermission(conversationId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const { conversation, phoneNumberId } = await conversationForCalling(conversationId, input.agent, db);
  if (toConversationDto(conversation).requiresTemplate) {
    throw new AppError("A janela de atendimento está encerrada. Use um template de permissão aprovado.", 409);
  }
  const current = await (dependencies.getCallPermission || whatsappService.getCallPermission)(
    phoneNumberId, conversation.contact.waId,
  );
  const canRequest = current.actions?.find((item) => item.action_name === "send_call_permission_request")?.can_perform_action;
  if (!canRequest) {
    const error = new AppError("A Meta não permite uma nova solicitação de chamada neste momento.", 409);
    error.publicCode = "CALL_PERMISSION_REQUEST_UNAVAILABLE";
    throw error;
  }
  const meta = await (dependencies.requestCallPermission || whatsappService.requestCallPermission)(
    phoneNumberId, conversation.contact.waId, input.body,
  );
  return { phoneNumberId, messageId: meta.messages?.[0]?.id || null, permission: current.permission };
}

async function initiate(conversationId, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const { conversation, phoneNumberId } = await conversationForCalling(conversationId, input.agent, db);
  const permission = await (dependencies.getCallPermission || whatsappService.getCallPermission)(
    phoneNumberId, conversation.contact.waId,
  );
  const canStart = permission.actions?.find((item) => item.action_name === "start_call")?.can_perform_action;
  if (!canStart) {
    const error = new AppError("É necessário obter permissão do cliente antes de iniciar a chamada.", 409);
    error.publicCode = "CALL_PERMISSION_REQUIRED";
    throw error;
  }
  const callbackData = `conversation:${conversation.id}`.slice(0, 512);
  const meta = await (dependencies.initiateCall || whatsappService.initiateCall)(
    phoneNumberId, conversation.contact.waId, input.session.sdp, callbackData,
  );
  const callId = meta.calls?.[0]?.id;
  if (!callId) throw new AppError("A Meta não retornou o ID da chamada.", 502);
  const now = new Date();
  const saved = await callRepository.create({
    metaCallId: callId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    phoneNumberId,
    direction: "OUTBOUND",
    status: "CONNECTING",
    remotePhone: conversation.contact.waId,
    startedAt: now,
    lastEventAt: now,
  }, db);
  emitCall(saved);
  return toCallDto(saved);
}

module.exports = {
  processCallEvent, processCallStatus, preAccept, accept, reject, terminate, listCalls,
  getPermission, requestPermission, initiate, parseTimestamp,
};
