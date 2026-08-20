const test = require("node:test");
const assert = require("node:assert/strict");
const { maskRecipient, sendReactionMessage, sendTextMessage } = require("../src/services/whatsapp.service");

test("mascara o número de destino preservando início e final", () => {
  assert.equal(maskRecipient("556697212427"), "5566****2427");
});

test("envia reação usando o contrato oficial da Meta", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let payload;
  process.env.WHATSAPP_ACCESS_TOKEN = "token-de-teste";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.reaction" }] }) };
  };
  try {
    await sendReactionMessage("5566999999999", "wamid.original", "👍");
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
  assert.deepEqual(payload, {
    messaging_product: "whatsapp",
    to: "5566999999999",
    type: "reaction",
    reaction: { message_id: "wamid.original", emoji: "👍" },
  });
});

test("envia resposta usando o contexto oficial da Meta", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let payload;
  process.env.WHATSAPP_ACCESS_TOKEN = "token-de-teste";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.reply" }] }) };
  };
  try {
    await sendTextMessage("5566999999999", "Resposta", "wamid.original");
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
  assert.deepEqual(payload.context, { message_id: "wamid.original" });
  assert.deepEqual(payload.text, { body: "Resposta" });
});
