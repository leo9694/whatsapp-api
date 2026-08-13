const logger = require("../utils/logger");
const messageDeduplicator = require("../utils/messageDeduplicator");
const whatsappService = require("../services/whatsapp.service");

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    logger.info("webhook_verification_succeeded");
    return res.status(200).send(challenge);
  }

  logger.warn("webhook_verification_rejected", { mode: mode || null });
  return res.sendStatus(403);
}

function processWebhookPayload(payload) {
  logger.info("webhook_payload_received", {
    object: payload?.object || null,
    payload,
  });

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      logger.info("webhook_change", {
        object: payload?.object || null,
        wabaId: entry?.id || null,
        phoneNumberId,
        field: change?.field || null,
        messageCount: messages.length,
        statusCount: statuses.length,
      });

      for (const message of messages) {
        if (messageDeduplicator.isDuplicate(message?.id)) {
          logger.warn("duplicate_message_ignored", {
            messageId: message?.id || null,
            phoneNumberId,
          });
          continue;
        }

        const contact = contacts.find((item) => item?.wa_id === message?.from) || contacts[0];
        logger.info("whatsapp_message_received", {
          object: payload?.object || null,
          wabaId: entry?.id || null,
          phoneNumberId,
          messageId: message?.id || null,
          wamid: message?.id || null,
          from: message?.from || null,
          messageTimestamp: message?.timestamp || null,
          type: message?.type || null,
          text: message?.text?.body || null,
          contactProfileName: contact?.profile?.name || null,
        });
      }

      for (const status of statuses) {
        logger.info("whatsapp_status_received", {
          object: payload?.object || null,
          wabaId: entry?.id || null,
          phoneNumberId,
          id: status?.id || null,
          status: status?.status || null,
          recipientId: status?.recipient_id || null,
          statusTimestamp: status?.timestamp || null,
        });
      }
    }
  }
}

function receiveWebhook(req, res) {
  res.sendStatus(200);

  setImmediate(() => {
    try {
      processWebhookPayload(req.body);
    } catch (error) {
      logger.error("webhook_processing_failed", { message: error.message });
    }
  });
}

async function sendTextMessage(req, res, next) {
  try {
    const { to, text } = req.body || {};
    if (typeof to !== "string" || !/^\d{8,15}$/.test(to.trim())) {
      return res.status(400).json({
        error: "O campo 'to' deve conter de 8 a 15 dígitos, incluindo o código do país.",
      });
    }

    if (typeof text !== "string" || !text.trim() || text.length > 4096) {
      return res.status(400).json({
        error: "O campo 'text' deve ser uma string entre 1 e 4096 caracteres.",
      });
    }

    const result = await whatsappService.sendTextMessage(to.trim(), text.trim());
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
  processWebhookPayload,
  sendTextMessage,
};
