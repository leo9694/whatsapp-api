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

async function sendTextMessage(to, text) {
  const accessToken = requiredEnvironment("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnvironment("WHATSAPP_PHONE_NUMBER_ID");
  const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v25.0";
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = data?.error || {};
    logger.error("whatsapp_message_send_failed", {
      to: maskRecipient(to),
      metaHttpStatus: response.status,
      metaError: {
        message: metaError.message || null,
        type: metaError.type || null,
        code: metaError.code || null,
        errorSubcode: metaError.error_subcode || null,
        fbtraceId: metaError.fbtrace_id || null,
      },
    });

    const error = new Error("A API da Meta recusou o envio da mensagem.");
    error.status = response.status;
    error.metaResponse = data;
    throw error;
  }

  logger.info("whatsapp_message_sent", {
    to: maskRecipient(to),
    metaHttpStatus: response.status,
    messageId: data.messages?.[0]?.id || null,
  });
  return data;
}

module.exports = { sendTextMessage, maskRecipient };
