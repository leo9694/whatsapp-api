const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const conversationRepository = require("../repositories/conversation.repository");
const messageRepository = require("../repositories/message.repository");
const whatsappService = require("./whatsapp.service");
const socket = require("../sockets/socket");
const logger = require("../utils/logger");
const templateService = require("./template.service");
const mediaService = require("./media.service");
const { toMessageDto } = require("../utils/messageDto");
const contactRepository = require("../repositories/contact.repository");
const { toConversationDto } = require("../utils/conversationDto");

function assertFreeTextWindow(conversation) {
  const dto = toConversationDto(conversation);
  if (dto.requiresTemplate) {
    throw new AppError("A janela de atendimento da Meta esta encerrada. Envie um template aprovado para iniciar a conversa.", 400);
  }
  return dto.serviceWindow;
}

async function listConversations({ page, limit, search, status, assignment = "MINE", viewerId }, db = prisma) {
  if (assignment === "MINE" && !viewerId) throw new AppError("Identificacao do atendente ausente.", 400);
  const [data, total] = await conversationRepository.list({
    skip: (page - 1) * limit,
    take: limit,
    search,
    status,
    assignment,
    viewerId,
  }, db);
  return {
    data: data.map(({ messages, ...conversation }) => toConversationDto(conversation, {
      lastMessage: toMessageDto(messages[0] || null),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

function assertAssigned(conversation, agent, { allowDirector = false } = {}) {
  if (!agent?.id) throw new AppError("Identificacao do atendente ausente.", 401);
  if (!conversation.assignedUserId) {
    throw new AppError("Esta conversa esta sem atendente. Assuma o atendimento antes de enviar mensagens.", 409);
  }
  if (String(conversation.assignedUserId) !== String(agent.id) && !(allowDirector && agent.director)) {
    throw new AppError(`Conversa em atendimento por ${conversation.assignedUserName || "outro atendente"}.`, 403);
  }
}

function signedText(text, agent) {
  const signature = String(agent?.signature || "").trim();
  return signature ? `*${signature}:*\n${text}` : text;
}

async function getConversation(id, db = prisma) {
  const conversation = await conversationRepository.findById(id, db);
  if (!conversation) throw new AppError("Conversa não encontrada.", 404);
  return toConversationDto(conversation);
}

function normalizeWhatsappNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  if (!/^[1-9]\d{9,14}$/.test(number)) {
    throw new AppError("Informe um numero de WhatsApp valido com DDI e DDD.", 400);
  }
  return number;
}

async function createConversation({ name, phone }, db = prisma) {
  const waId = normalizeWhatsappNumber(phone);
  const result = await db.$transaction(async (tx) => {
    const contact = await contactRepository.upsertByWaId({ waId, phone: waId, name: name || undefined }, tx);
    let conversation = await conversationRepository.findOpenByContactId(contact.id, tx);
    const created = !conversation;
    if (created) conversation = await conversationRepository.createForContact(contact.id, tx);
    const complete = await conversationRepository.findById(conversation.id, tx);
    return { conversation: toConversationDto(complete), contact, created };
  });
  if (result.created) socket.emit("conversation:new", { conversation: result.conversation });
  return result;
}

async function listMessages(id, { page, limit }, db = prisma) {
  await getConversation(id, db);
  const [items, total] = await messageRepository.listByConversation({
    conversationId: id,
    skip: (page - 1) * limit,
    take: limit,
  }, db);
  return {
    data: items.reverse().map(toMessageDto),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function sendText(id, text, agent, dependencies = {}) {
  const db = dependencies.db || prisma;
  const send = dependencies.sendTextMessage || whatsappService.sendTextMessage;
  const conversation = await getConversation(id, db);
  if (agent) assertAssigned(conversation, agent);
  assertFreeTextWindow(conversation);
  const outgoingText = agent ? signedText(text, agent) : text;
  const meta = await send(conversation.contact.waId, outgoingText);
  const wamid = meta.messages?.[0]?.id || null;
  const now = new Date();
  const message = await persistOutbound(id, {
    wamid,
    type: "text",
    text: outgoingText,
    senderUserId: agent ? String(agent.id) : null,
    senderUserName: agent?.name || null,
    status: "SENT",
    messageTimestamp: now,
  }, db);
  emitOutbound(id, message, now, await getConversation(id, db));
  return message;
}

async function sendReaction(id, messageId, emoji, agent, dependencies = {}) {
  const db = dependencies.db || prisma;
  const send = dependencies.sendReactionMessage || whatsappService.sendReactionMessage;
  const conversation = await getConversation(id, db);
  if (agent) assertAssigned(conversation, agent);
  assertFreeTextWindow(conversation);
  const target = await messageRepository.findByWamid(messageId, db);
  if (!target || String(target.conversationId) !== String(id)) {
    throw new AppError("A mensagem selecionada não pertence a esta conversa.", 404);
  }
  const meta = await send(conversation.contact.waId, messageId, emoji);
  const now = new Date();
  const message = await persistOutbound(id, {
    wamid: meta.messages?.[0]?.id || null,
    type: "reaction",
    text: JSON.stringify({ message_id: messageId, emoji }),
    senderUserId: agent ? String(agent.id) : null,
    senderUserName: agent?.name || null,
    status: "SENT",
    messageTimestamp: now,
  }, db);
  emitOutbound(id, message, now, await getConversation(id, db));
  return message;
}

async function persistOutbound(conversationId, data, db = prisma, conversationUpdate) {
  const timestamp = data.messageTimestamp || new Date();
  return db.$transaction(async (tx) => {
    const created = await messageRepository.create({
      conversationId,
      direction: "OUTBOUND",
      ...data,
    }, tx);
    if (conversationUpdate === "template") {
      await conversationRepository.updateAfterTemplate(conversationId, {
        lastMessageAt: timestamp, wamid: data.wamid, status: data.status,
      }, tx);
    } else {
      await conversationRepository.updateLastMessageAt(conversationId, timestamp, tx);
    }
    return created;
  });
}

function emitOutbound(conversationId, message, lastMessageAt, conversation) {
  const dto = toMessageDto(message);
  socket.emit("message:new", { conversationId, message: dto });
  socket.emit("conversation:updated", {
    ...(conversation || {}), conversationId, lastMessageAt, lastMessage: dto,
  });
}

async function sendTemplate(id, input, agent, dependencies = {}) {
  const db = dependencies.db || prisma;
  const findTemplate = dependencies.findTemplate || templateService.findTemplate;
  const send = dependencies.sendTemplateMessage || whatsappService.sendTemplateMessage;
  const conversation = await getConversation(id, db);
  if (agent) assertAssigned(conversation, agent);
  const found = await findTemplate(input.templateName, input.language);
  if (found.template.status !== "APPROVED") throw new AppError("Somente templates aprovados podem ser enviados.", 400);
  const meta = await send(conversation.contact.waId, input.templateName, input.language, input.components || []);
  const wamid = meta.messages?.[0]?.id || null;
  if (!wamid) throw new AppError("A Meta aceitou a solicitação sem retornar o ID da mensagem.", 502);
  const now = new Date();
  const rendered = templateService.renderTemplate(found.template, input.components || []);
  const message = await persistOutbound(id, {
    wamid,
    type: "template",
    text: rendered.body || rendered.header || input.templateName,
    status: "SENT",
    messageTimestamp: now,
    templateName: input.templateName,
    templateLanguage: input.language,
    templateComponents: input.components || [],
    templateData: rendered,
    renderedText: rendered.body || null,
    senderUserId: agent ? String(agent.id) : null,
    senderUserName: agent?.name || null,
  }, db, "template");
  emitOutbound(id, message, now, await getConversation(id, db));
  return message;
}

async function sendMedia(id, kind, file, options = {}, agent, dependencies = {}) {
  const db = dependencies.db || prisma;
  const upload = dependencies.upload || mediaService.upload;
  const conversation = await getConversation(id, db);
  if (agent) assertAssigned(conversation, agent);
  assertFreeTextWindow(conversation);
  const uploaded = await upload(file, kind, dependencies);
  const senders = {
    image: dependencies.sendImageMessage || whatsappService.sendImageMessage,
    document: dependencies.sendDocumentMessage || whatsappService.sendDocumentMessage,
    video: dependencies.sendVideoMessage || whatsappService.sendVideoMessage,
    audio: dependencies.sendAudioMessage || whatsappService.sendAudioMessage,
  };
  const send = senders[kind];
  let meta;
  if (kind === "document") meta = await send(conversation.contact.waId, uploaded.mediaId, options.caption, options.filename || uploaded.filename);
  else if (kind === "audio") meta = await send(conversation.contact.waId, uploaded.mediaId, { voice: options.voice });
  else meta = await send(conversation.contact.waId, uploaded.mediaId, options.caption);
  const now = new Date();
  const message = await persistOutbound(id, {
    wamid: meta.messages?.[0]?.id || null,
    type: kind,
    status: "SENT",
    messageTimestamp: now,
    mediaId: uploaded.mediaId,
    mimeType: uploaded.mimeType,
    filename: kind === "document" ? options.filename || uploaded.filename : uploaded.filename,
    caption: options.caption || null,
    voice: kind === "audio" ? Boolean(options.voice) : null,
    senderUserId: agent ? String(agent.id) : null,
    senderUserName: agent?.name || null,
  }, db);
  emitOutbound(id, message, now, await getConversation(id, db));
  return message;
}

async function markRead(id, dependencies = {}) {
  const db = dependencies.db || prisma;
  const markMetaRead = dependencies.markMessageAsRead || whatsappService.markMessageAsRead;
  await getConversation(id, db);
  const latestInbound = await messageRepository.findLatestInbound(id, db);
  const conversation = await conversationRepository.markRead(id, db);
  let metaMarked = false;
  if (latestInbound?.wamid) {
    try {
      await markMetaRead(latestInbound.wamid);
      metaMarked = true;
    } catch (error) {
      logger.error("whatsapp_mark_read_failed", { conversationId: id, message: error.message });
    }
  }
  socket.emit("conversation:read", { conversationId: id, unreadCount: 0 });
  return { conversation, metaMarked };
}

async function changeStatus(id, status, agent, db = prisma) {
  const current = await getConversation(id, db);
  if (agent) assertAssigned(current, agent, { allowDirector: true });
  const conversation = await conversationRepository.updateStatus(id, status, db);
  socket.emit("conversation:status", { conversationId: id, status });
  socket.emit("conversation:updated", { conversationId: id, status });
  return conversation;
}

async function changeAssignment(id, input, db = prisma) {
  const conversation = await db.$transaction(async (tx) => {
    const current = await getConversation(id, tx);
    const actorId = String(input.actor.id);
    const owns = String(current.assignedUserId || "") === actorId;
    const director = input.actor.director === true;
    let data;

    if (input.action === "CLAIM") {
      if (current.assignedUserId && !owns) {
        throw new AppError(`Conversa em atendimento por ${current.assignedUserName || "outro atendente"}.`, 409);
      }
      data = { assignedUserId: actorId, assignedUserName: input.actor.name, assignedAt: current.assignedAt || new Date() };
    } else if (input.action === "TRANSFER") {
      if (!owns && !director) throw new AppError("Somente o atendente atual pode transferir esta conversa.", 403);
      if (!input.target?.id) throw new AppError("Selecione o atendente de destino.", 400);
      data = { assignedUserId: String(input.target.id), assignedUserName: input.target.name, assignedAt: new Date() };
    } else {
      if (!owns && !director) throw new AppError("Somente o atendente atual pode liberar esta conversa.", 403);
      data = { assignedUserId: null, assignedUserName: null, assignedAt: null };
    }

    let updated;
    if (input.action === "CLAIM" && !current.assignedUserId) {
      const claimed = await conversationRepository.claimIfUnassigned(id, data, tx);
      if (claimed.count !== 1) {
        const winner = await getConversation(id, tx);
        throw new AppError(`Conversa em atendimento por ${winner.assignedUserName || "outro atendente"}.`, 409);
      }
      updated = await conversationRepository.findById(id, tx);
    } else {
      updated = await conversationRepository.updateAssignment(id, data, tx);
    }
    await conversationRepository.createAssignmentHistory({
      conversationId: id,
      action: input.action,
      actorUserId: actorId,
      actorUserName: input.actor.name,
      targetUserId: data.assignedUserId,
      targetUserName: data.assignedUserName,
    }, tx);
    return toConversationDto(updated);
  });
  const payload = { conversationId: id, conversation };
  socket.emit("conversation:assignment", payload);
  socket.emit("conversation:updated", payload);
  return conversation;
}

async function deleteConversation(id, db = prisma) {
  await getConversation(id, db);
  await conversationRepository.deleteById(id, db);
  socket.emit("conversation:deleted", { conversationId: id });
  return { id, deleted: true };
}

module.exports = {
  listConversations, getConversation, createConversation, listMessages, sendText, sendReaction, sendTemplate, sendMedia,
  markRead, changeStatus, changeAssignment, deleteConversation, persistOutbound, normalizeWhatsappNumber,
  assertAssigned, assertFreeTextWindow, signedText,
};
