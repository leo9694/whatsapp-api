const prisma = require("../database/prisma");
const contactRepository = require("../repositories/contact.repository");
const conversationRepository = require("../repositories/conversation.repository");
const messageRepository = require("../repositories/message.repository");
const socket = require("../sockets/socket");
const logger = require("../utils/logger");
const { toMessageDto } = require("../utils/messageDto");
const { toConversationDto } = require("../utils/conversationDto");

const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);
const STATUS_MAP = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

function parseTimestamp(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function extractContent(message) {
  let type = typeof message?.type === "string" ? message.type : "unknown";
  const media = MEDIA_TYPES.has(type) ? message[type] || {} : {};
  let text = message?.text?.body || null;
  if (type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    text = reply?.title || reply?.description || reply?.id || null;
    if (text) type = "text";
  }
  if (type === "button") {
    text = message.button?.text || message.button?.payload || null;
    if (text) type = "text";
  }
  if (!text && ["location", "contacts", "reaction", "interactive", "button"].includes(type)) {
    const value = message[type] ?? message;
    text = JSON.stringify(value);
  }
  return {
    type,
    text,
    mediaId: media.id || null,
    mimeType: media.mime_type || null,
    filename: media.filename || null,
    caption: media.caption || null,
    mediaSha256: media.sha256 || null,
    voice: type === "audio" ? Boolean(media.voice) : null,
  };
}

async function processInboundMessage({ message, contacts = [] }, dependencies = {}) {
  const db = dependencies.db || prisma;
  const waId = message?.from;
  if (!waId) {
    logger.warn("inbound_message_without_sender", { messageId: message?.id || null });
    return { ignored: true, reason: "missing_sender" };
  }

  const existing = await messageRepository.findByWamid(message.id, db);
  if (existing) return { duplicate: true, message: existing };

  const contactPayload = contacts.find((item) => item?.wa_id === waId) || contacts[0];
  const profileName = contactPayload?.profile?.name || null;
  const messageTimestamp = parseTimestamp(message.timestamp);
  const content = extractContent(message);

  try {
    const result = await db.$transaction(async (tx) => {
      const contact = await contactRepository.upsertByWaId({ waId, phone: waId, profileName }, tx);
      let conversation = await conversationRepository.findOpenByContactId(contact.id, tx);
      let isNewConversation = false;
      if (!conversation) {
        conversation = await conversationRepository.createForContact(contact.id, tx);
        isNewConversation = true;
      }
      const createdMessage = await messageRepository.create({
        wamid: message.id || null,
        conversationId: conversation.id,
        direction: "INBOUND",
        status: "RECEIVED",
        messageTimestamp,
        replyContext: await inboundReplyContext(message, conversation.id, tx),
        ...content,
      }, tx);
      const updatedConversation = await conversationRepository.updateAfterInbound(conversation.id, messageTimestamp, tx);
      return { contact, conversation: updatedConversation, message: createdMessage, isNewConversation };
    });

    const conversationDto = toConversationDto(result.conversation);
    if (result.isNewConversation) socket.emit("conversation:new", { conversation: conversationDto });
    socket.emit("message:new", { conversationId: result.conversation.id, message: toMessageDto(result.message) });
    socket.emit("conversation:updated", {
      ...conversationDto,
      conversationId: conversationDto.id,
      lastMessage: toMessageDto(result.message),
    });
    return { ...result, conversation: conversationDto };
  } catch (error) {
    if (error?.code === "P2002" && message.id) {
      return { duplicate: true, message: await messageRepository.findByWamid(message.id, db) };
    }
    throw error;
  }
}

async function inboundReplyContext(message, conversationId, db) {
  const messageId = String(message?.context?.id || "").trim();
  if (!messageId) return null;
  const target = await messageRepository.findByWamid(messageId, db);
  if (!target || String(target.conversationId) !== String(conversationId)) {
    return { messageId, text: "Mensagem", senderName: "", direction: "" };
  }
  return {
    messageId,
    text: target.text || target.caption || target.filename || "Mensagem",
    senderName: target.senderUserName || (target.direction === "OUTBOUND" ? "Atendente" : "Contato"),
    direction: target.direction,
  };
}

async function processStatus(status, db = prisma) {
  const mapped = STATUS_MAP[status?.status];
  if (!status?.id || !mapped) return { ignored: true };
  const existing = await messageRepository.findByWamid(status.id, db);
  if (!existing) return { ignored: true, reason: "message_not_found" };
  const result = await db.$transaction(async (tx) => {
    const updated = await messageRepository.updateStatusByWamid(status.id, mapped, tx);
    let conversation = await conversationRepository.findById(updated.conversationId, tx);
    if (conversation?.initialTemplateWamid === status.id) {
      conversation = await conversationRepository.updateInitialTemplateStatus(conversation.id, mapped, tx);
    }
    return { updated, conversation };
  });
  const updated = result.updated;
  socket.emit("message:status", {
    conversationId: updated.conversationId,
    messageId: updated.id,
    wamid: updated.wamid,
    status: updated.status,
  });
  if (result.conversation) {
    const conversationDto = toConversationDto(result.conversation);
    socket.emit("conversation:updated", { ...conversationDto, conversationId: conversationDto.id });
  }
  return updated;
}

module.exports = { extractContent, parseTimestamp, processInboundMessage, processStatus, STATUS_MAP };
