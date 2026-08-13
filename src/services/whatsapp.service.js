const logger = require("../utils/logger");

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
    const error = new Error("A API da Meta recusou o envio da mensagem.");
    error.status = response.status;
    error.metaResponse = data;
    throw error;
  }

  logger.info("whatsapp_message_sent", {
    to,
    messageId: data.messages?.[0]?.id || null,
  });
  return data;
}

module.exports = { sendTextMessage };
