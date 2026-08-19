const logger = require("../utils/logger");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

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

async function sendReactionMessage(to, messageId, emoji) {
  return (await sendMessage(to, {
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  })).data;
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

async function sendTemplateMessage(to, templateName, language, components = []) {
  return (await sendMessage(to, {
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  })).data;
}

async function markMessageAsRead(messageId) {
  const { phoneNumberId, apiVersion } = getConfiguration();
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  return (await graphRequest(url, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  })).data;
}

async function listMessageTemplates() {
  const { accessToken, apiVersion } = getConfiguration();
  const wabaId = requiredEnvironment("WHATSAPP_WABA_ID");
  const fields = "id,name,language,status,category,parameter_format,components,quality_score,rejected_reason,previous_category";
  let url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100&fields=${encodeURIComponent(fields)}`;
  const templates = [];
  let pages = 0;
  while (url && pages < 100) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new MetaApiError("Não foi possível consultar os templates.", response.status, data);
    if (Array.isArray(data.data)) templates.push(...data.data);
    url = data.paging?.next || null;
    pages += 1;
  }
  return templates;
}

async function getMediaMetadata(mediaId) {
  const { apiVersion, phoneNumberId } = getConfiguration();
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(phoneNumberId)}`;
  return (await graphRequest(url)).data;
}

async function downloadMedia(mediaId) {
  const { accessToken } = getConfiguration();
  const metadata = await getMediaMetadata(mediaId);
  const mediaUrl = new URL(metadata.url);
  const trustedSuffixes = [".facebook.com", ".facebook.net", ".fbcdn.net", ".fbsbx.com"];
  if (mediaUrl.protocol !== "https:" || !trustedSuffixes.some((suffix) => mediaUrl.hostname.endsWith(suffix))) {
    throw new MetaApiError("A Meta retornou uma URL de mídia inválida.", 502, {});
  }
  try {
    const response = await axios.get(mediaUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "stream",
      timeout: 30000,
      maxRedirects: 3,
    });
    return { stream: response.data, headers: response.headers, metadata };
  } catch (error) {
    const status = error.response?.status || 502;
    throw new MetaApiError("Não foi possível baixar a mídia da Meta.", status, error.response?.data || {});
  }
}

async function uploadMedia({ filePath, mimeType, filename }) {
  const { accessToken, apiVersion, phoneNumberId } = getConfiguration();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", fs.createReadStream(filePath), { contentType: mimeType, filename });
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
      form,
      {
        headers: { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() },
        maxBodyLength: Infinity,
        timeout: 120000,
      },
    );
    return response.data;
  } catch (error) {
    const status = error.response?.status || 502;
    throw new MetaApiError("Não foi possível enviar a mídia para a Meta.", status, error.response?.data || {});
  }
}

module.exports = {
  sendTextMessage,
  sendReactionMessage,
  sendImageMessage,
  sendDocumentMessage,
  sendAudioMessage,
  sendVideoMessage,
  sendTemplateMessage,
  markMessageAsRead,
  listMessageTemplates,
  getMediaMetadata,
  downloadMedia,
  uploadMedia,
  maskRecipient,
  MetaApiError,
};
