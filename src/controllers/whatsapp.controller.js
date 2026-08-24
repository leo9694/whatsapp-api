const logger = require("../utils/logger");
const messageService = require("../services/message.service");
const callService = require("../services/call.service");

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

async function processWebhookPayload(payload, dependencies = {}) {
  const messagesApi = dependencies.messageService || messageService;
  const callsApi = dependencies.callService || callService;
  logger.info("webhook_payload_received", {
    object: payload?.object || null,
    entryCount: Array.isArray(payload?.entry) ? payload.entry.length : 0,
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
      const calls = Array.isArray(value.calls) ? value.calls : [];

      logger.info("webhook_change", {
        object: payload?.object || null,
        wabaId: entry?.id || null,
        phoneNumberId,
        field: change?.field || null,
        messageCount: messages.length,
        statusCount: statuses.length,
        callCount: calls.length,
      });

      for (const message of messages) {
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
        try {
          const result = await messagesApi.processInboundMessage({ message, contacts, phoneNumberId });
          if (result?.duplicate) {
            logger.warn("duplicate_message_ignored", { messageId: message?.id || null, phoneNumberId });
          }
        } catch (error) {
          logger.error("whatsapp_message_processing_failed", { messageId: message?.id || null, message: error.message });
        }
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
        try {
          if (status?.type === "call") await callsApi.processCallStatus({ status, phoneNumberId });
          else await messagesApi.processStatus(status);
        } catch (error) {
          logger.error("whatsapp_status_processing_failed", { id: status?.id || null, message: error.message });
        }
      }

      for (const call of calls) {
        logger.info("whatsapp_call_received", {
          callId: call?.id || null,
          phoneNumberId,
          callEvent: call?.event || null,
          direction: call?.direction || null,
          callTimestamp: call?.timestamp || null,
          hasSession: Boolean(call?.session?.sdp),
        });
        try {
          await callsApi.processCallEvent({
            call,
            contacts,
            phoneNumberId,
            errors: Array.isArray(value.errors) ? value.errors : [],
          });
        } catch (error) {
          logger.error("whatsapp_call_processing_failed", { callId: call?.id || null, message: error.message });
        }
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
