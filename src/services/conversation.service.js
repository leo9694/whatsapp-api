const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const conversationRepository = require("../repositories/conversation.repository");
const messageRepository = require("../repositories/message.repository");
const whatsappService = require("./whatsapp.service");
const socket = require("../sockets/socket");
const logger = require("../utils/logger");

async function listConversations({ page, limit, search, status }, db = prisma) {
  const [data, total] = await conversationRepository.list({
    skip: (page - 1) * limit,
    take: limit,
    search,
    status,
  }, db);
  return {
    data: data.map(({ messages, ...conversation }) => ({ ...conversation, lastMessage: messages[0] || null })),
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
    data: items.reverse(),
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
  const message = await db.$transaction(async (tx) => {
    const created = await messageRepository.create({
      wamid,
      conversationId: id,
      direction: "OUTBOUND",
      type: "text",
      text,
      status: "SENT",
      messageTimestamp: now,
    }, tx);
    await conversationRepository.updateLastMessageAt(id, now, tx);
    return created;
  });
  socket.emit("message:new", { conversationId: id, message });
  socket.emit("conversation:updated", { conversationId: id, lastMessageAt: now, lastMessage: message });
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

module.exports = { listConversations, getConversation, listMessages, sendText, markRead, changeStatus };
