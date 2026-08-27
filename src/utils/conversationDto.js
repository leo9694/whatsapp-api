const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const { toChannelDto } = require("./channelDto");

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toServiceWindow(conversation, now = new Date()) {
  const expiresAt = conversation?.customerServiceWindowExpiresAt
    ? new Date(conversation.customerServiceWindowExpiresAt)
    : null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const remainingMilliseconds = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? Math.max(0, expiresAt.getTime() - nowDate.getTime())
    : 0;
  const canSendFreeform = remainingMilliseconds > 0;
  return {
    conversationInitiated: Boolean(conversation?.conversationInitiated),
    initiatedAt: iso(conversation?.conversationInitiatedAt),
    initialTemplateWamid: conversation?.initialTemplateWamid || null,
    initialTemplateStatus: conversation?.initialTemplateStatus || null,
    waitingForCustomerReply: Boolean(conversation?.waitingForCustomerReply),
    canSendFreeform,
    requiresTemplate: !canSendFreeform,
    openedAt: iso(conversation?.customerServiceWindowOpenedAt),
    expiresAt: iso(conversation?.customerServiceWindowExpiresAt),
  };
}

function toConversationDto(conversation, options = {}) {
  if (!conversation) return conversation;
  const serviceWindow = toServiceWindow(conversation, options.now);
  return {
    ...conversation,
    ...(options.lastMessage !== undefined ? { lastMessage: options.lastMessage } : {}),
    serviceWindow,
    // Compatibility aliases for the existing chat frontend.
    metaWindow: {
      status: serviceWindow.canSendFreeform ? "OPEN" : "CLOSED",
      openedAt: serviceWindow.openedAt,
      expiresAt: serviceWindow.expiresAt,
      requiresTemplate: serviceWindow.requiresTemplate,
      remainingSeconds: serviceWindow.expiresAt
        ? Math.ceil(Math.max(0, new Date(serviceWindow.expiresAt).getTime() - new Date(options.now || Date.now()).getTime()) / 1000)
        : 0,
    },
    canSendFreeform: serviceWindow.canSendFreeform,
    canSendFreeText: serviceWindow.canSendFreeform,
    requiresTemplate: serviceWindow.requiresTemplate,
    phoneNumberId: conversation.channel?.phoneNumberId || conversation.phoneNumberId || null,
    channel: toChannelDto(conversation.channel),
    assignment: conversation.assignedUserId ? {
      userId: String(conversation.assignedUserId),
      userName: conversation.assignedUserName || null,
      assignedAt: iso(conversation.assignedAt),
    } : null,
  };
}

module.exports = { SERVICE_WINDOW_MS, toServiceWindow, toConversationDto };
