const test = require("node:test");
const assert = require("node:assert/strict");
const {
  maskRecipient, sendReactionMessage, sendTextMessage, preAcceptCall,
  requestCallPermission, getCallPermission,
} = require("../src/services/whatsapp.service");

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

test("pré-aceita chamada usando o contrato oficial da Meta", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalVersion = process.env.META_GRAPH_API_VERSION;
  let request;
  process.env.WHATSAPP_ACCESS_TOKEN = "token-de-teste";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  global.fetch = async (url, options) => {
    request = { url, payload: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  try { await preAcceptCall("phone-2", "wacid.test", "v=0 SDP answer"); }
  finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    if (originalVersion === undefined) delete process.env.META_GRAPH_API_VERSION; else process.env.META_GRAPH_API_VERSION = originalVersion;
  }
  assert.equal(request.url, "https://graph.facebook.com/v26.0/phone-2/calls");
  assert.deepEqual(request.payload, {
    messaging_product: "whatsapp",
    call_id: "wacid.test",
    action: "pre_accept",
    session: { sdp_type: "answer", sdp: "v=0 SDP answer" },
  });
});

test("consulta e solicita permissão de chamada pelos endpoints oficiais", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalVersion = process.env.META_GRAPH_API_VERSION;
  const requests = [];
  process.env.WHATSAPP_ACCESS_TOKEN = "token-de-teste";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET", payload: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ actions: [], messages: [{ id: "wamid.permission" }] }) };
  };
  try {
    await getCallPermission("phone-3", "556697212427");
    await requestCallPermission("phone-3", "556697212427", "Podemos ligar?");
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    if (originalVersion === undefined) delete process.env.META_GRAPH_API_VERSION; else process.env.META_GRAPH_API_VERSION = originalVersion;
  }
  assert.equal(requests[0].url, "https://graph.facebook.com/v26.0/phone-3/call_permissions?user_wa_id=556697212427");
  assert.equal(requests[0].method, "GET");
  assert.deepEqual(requests[1].payload.interactive, {
    type: "call_permission_request",
    action: { name: "call_permission_request" },
    body: { text: "Podemos ligar?" },
  });
});
