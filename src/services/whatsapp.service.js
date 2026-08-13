const logger = require("../utils/logger");

function maskRecipient(to) {
  if (to.length <= 8) return "*".repeat(to.length);
  return `${to.slice(0, 4)}${"*".repeat(to.length - 8)}${to.slice(-4)}`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

class MetaApiError extends Error {
  constructor(message, status, metaResponse) {
    super(message);
    this.name = "MetaApiError";
    this.status = status >= 500 ? 502 : status;
    this.metaHttpStatus = status;
    this.metaResponse = metaResponse;
  }
}

function getConfiguration() {
  return {
    accessToken: requiredEnvironment("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requiredEnvironment("WHATSAPP_PHONE_NUMBER_ID"),
    apiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "v25.0",
  };
}

async function graphRequest(url, options = {}) {
  const { accessToken } = getConfiguration();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MetaApiError("A API da Meta recusou a solicitação.", response.status, data);
  return { data, status: response.status };
}

async function sendMessage(to, message) {
  const { phoneNumberId, apiVersion } = getConfiguration();
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  return graphRequest(url, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
  });
}

async function sendTextMessage(to, text) {
  try {
    const { data, status } = await sendMessage(to, { type: "text", text: { body: text } });
    logger.info("whatsapp_message_sent", {
      to: maskRecipient(to),
      metaHttpStatus: status,
      messageId: data.messages?.[0]?.id || null,
    });
    return data;
  } catch (error) {
    const metaError = error.metaResponse?.error || {};
    logger.error("whatsapp_message_send_failed", {
      to: maskRecipient(to),
      metaHttpStatus: error.metaHttpStatus || null,
      metaError: {
        message: metaError.message || null,
        type: metaError.type || null,
        code: metaError.code || null,
        errorSubcode: metaError.error_subcode || null,
        fbtraceId: metaError.fbtrace_id || null,
      },
    });

    throw error;
  }
}

async function sendImageMessage(to, mediaId, caption) {
  return (await sendMessage(to, { type: "image", image: { id: mediaId, ...(caption ? { caption } : {}) } })).data;
}

async function sendDocumentMessage(to, mediaId, caption, filename) {
  return (await sendMessage(to, {
    type: "document",
    document: { id: mediaId, ...(caption ? { caption } : {}), ...(filename ? { filename } : {}) },
  })).data;
}

async function sendAudioMessage(to, mediaId) {
  return (await sendMessage(to, { type: "audio", audio: { id: mediaId } })).data;
}

async function sendVideoMessage(to, mediaId, caption) {
  return (await sendMessage(to, { type: "video", video: { id: mediaId, ...(caption ? { caption } : {}) } })).data;
}

async function markMessageAsRead(messageId) {
  const { phoneNumberId, apiVersion } = getConfiguration();
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  return (await graphRequest(url, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  })).data;
}

async function getMediaUrl(mediaId) {
  const { apiVersion } = getConfiguration();
  return (await graphRequest(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(mediaId)}`)).data;
}

async function downloadMedia(url) {
  const { accessToken } = getConfiguration();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new MetaApiError("Não foi possível baixar a mídia da Meta.", response.status, {});
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") };
}

module.exports = {
  sendTextMessage,
  sendImageMessage,
  sendDocumentMessage,
  sendAudioMessage,
  sendVideoMessage,
  markMessageAsRead,
  getMediaUrl,
  downloadMedia,
  maskRecipient,
  MetaApiError,
};
