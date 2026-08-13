const logger = require("../utils/logger");
const messageDeduplicator = require("../utils/messageDeduplicator");
const messageService = require("../services/message.service");

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

async function processWebhookPayload(payload) {
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
        await messageService.processInboundMessage({ message, contacts });
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
        await messageService.processStatus(status);
      }
    }
  }
}

function receiveWebhook(req, res) {
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      await processWebhookPayload(req.body);
    } catch (error) {
      logger.error("webhook_processing_failed", { message: error.message });
    }
  });
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
  processWebhookPayload,
};
