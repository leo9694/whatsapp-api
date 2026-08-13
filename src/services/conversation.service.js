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

async function listConversations({ page, limit, search, status }, db = prisma) {
  const [data, total] = await conversationRepository.list({
    skip: (page - 1) * limit,
    take: limit,
    search,
    status,
  }, db);
  return {
    data: data.map(({ messages, ...conversation }) => ({ ...conversation, lastMessage: toMessageDto(messages[0] || null) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getConversation(id, db = prisma) {
  const conversation = await conversationRepository.findById(id, db);
  if (!conversation) throw new AppError("Conversa não encontrada.", 404);
  return conversation;
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

async function sendText(id, text, dependencies = {}) {
  const db = dependencies.db || prisma;
  const send = dependencies.sendTextMessage || whatsappService.sendTextMessage;
  const conversation = await getConversation(id, db);
  const meta = await send(conversation.contact.waId, text);
  const wamid = meta.messages?.[0]?.id || null;
  const now = new Date();
  const message = await persistOutbound(id, {
    wamid,
    type: "text",
    text,
    status: "SENT",
    messageTimestamp: now,
  }, db);
  emitOutbound(id, message, now);
  return message;
}

async function persistOutbound(conversationId, data, db = prisma) {
  const timestamp = data.messageTimestamp || new Date();
  return db.$transaction(async (tx) => {
    const created = await messageRepository.create({
      conversationId,
      direction: "OUTBOUND",
      ...data,
    }, tx);
    await conversationRepository.updateLastMessageAt(conversationId, timestamp, tx);
    return created;
  });
}

function emitOutbound(conversationId, message, lastMessageAt) {
  const dto = toMessageDto(message);
  socket.emit("message:new", { conversationId, message: dto });
  socket.emit("conversation:updated", { conversationId, lastMessageAt, lastMessage: dto });
}

async function sendTemplate(id, input, dependencies = {}) {
  const db = dependencies.db || prisma;
  const findTemplate = dependencies.findTemplate || templateService.findTemplate;
  const send = dependencies.sendTemplateMessage || whatsappService.sendTemplateMessage;
  const conversation = await getConversation(id, db);
  const found = await findTemplate(input.templateName, input.language);
  if (found.template.status !== "APPROVED") throw new AppError("Somente templates aprovados podem ser enviados.", 400);
  const meta = await send(conversation.contact.waId, input.templateName, input.language, input.components || []);
  const now = new Date();
  const message = await persistOutbound(id, {
    wamid: meta.messages?.[0]?.id || null,
    type: "template",
    text: null,
    status: "SENT",
    messageTimestamp: now,
    templateName: input.templateName,
    templateLanguage: input.language,
    templateComponents: input.components || [],
  }, db);
  emitOutbound(id, message, now);
  return message;
}

async function sendMedia(id, kind, file, options = {}, dependencies = {}) {
  const db = dependencies.db || prisma;
  const upload = dependencies.upload || mediaService.upload;
  const conversation = await getConversation(id, db);
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
  }, db);
  emitOutbound(id, message, now);
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

async function changeStatus(id, status, db = prisma) {
  await getConversation(id, db);
  const conversation = await conversationRepository.updateStatus(id, status, db);
  socket.emit("conversation:status", { conversationId: id, status });
  socket.emit("conversation:updated", { conversationId: id, status });
  return conversation;
}

module.exports = {
  listConversations, getConversation, listMessages, sendText, sendTemplate, sendMedia,
  markRead, changeStatus, persistOutbound,
};
