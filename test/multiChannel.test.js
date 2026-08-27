const test = require("node:test");
const assert = require("node:assert/strict");

const conversationService = require("../src/services/conversation.service");
const messageService = require("../src/services/message.service");
const callService = require("../src/services/call.service");
const channelService = require("../src/services/whatsappChannel.service");
const whatsappController = require("../src/controllers/whatsapp.controller");
const socket = require("../src/sockets/socket");
const { createFakePrisma } = require("./helpers/fakePrisma");

const MAIN_ID = "1226938830493899";
const SECOND_ID = "1272418099287669";
const WA_ID = "556697212427";
const AGENT = { id: "72", name: "Leonardo", director: false };

function inbound(wamid, phoneNumberId, body = "Olá") {
  return {
    message: {
      id: wamid, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)),
      type: "text", text: { body },
    },
    contacts: [{ wa_id: WA_ID, profile: { name: "Mesmo cliente" } }],
    phoneNumberId,
  };
}

function grantedPermission() {
  return {
    permission: { status: "temporary", expiration_time: Math.floor(Date.now() / 1000) + 86400 },
    actions: [{ action_name: "start_call", can_perform_action: true }],
  };
}

test.beforeEach(() => { process.env.CALL_MEDIA_GATEWAY_ENABLED = "false"; });

test("mantém o mesmo contato em conversas independentes por canal e filtra a listagem", async () => {
  const db = createFakePrisma();
  const first = await conversationService.createConversation({ name: "Cliente", phone: WA_ID }, db);
  const second = await conversationService.createConversation({ name: "Cliente", phone: WA_ID, channelId: 2 }, db);

  assert.notEqual(first.conversation.id, second.conversation.id);
  assert.equal(first.conversation.contactId, second.conversation.contactId);
  assert.equal(first.conversation.channel.phoneNumberId, MAIN_ID);
  assert.equal(first.conversation.channel.isDefault, true);
  assert.equal(second.conversation.channel.phoneNumberId, SECOND_ID);
  assert.equal(second.conversation.channel.isDefault, false);

  const filtered = await conversationService.listConversations({
    page: 1, limit: 30, assignment: "ALL", channelId: 2,
  }, db);
  assert.deepEqual(filtered.data.map((item) => item.id), [second.conversation.id]);
  const byPhone = await conversationService.listConversations({
    page: 1, limit: 30, assignment: "ALL", phoneNumberId: MAIN_ID,
  }, db);
  assert.deepEqual(byPhone.data.map((item) => item.id), [first.conversation.id]);
});

test("webhooks dos dois números persistem por canal e Socket.IO inclui o canal", async () => {
  const db = createFakePrisma();
  const events = [];
  const originalEmit = socket.emit;
  socket.emit = (event, payload) => events.push({ event, payload });
  try {
    const first = await messageService.processInboundMessage(inbound("wamid.main", MAIN_ID), { db });
    const second = await messageService.processInboundMessage(inbound("wamid.second", SECOND_ID), { db });
    assert.notEqual(first.conversation.id, second.conversation.id);
    assert.equal(first.conversation.channel.phoneNumberId, MAIN_ID);
    assert.equal(second.conversation.channel.phoneNumberId, SECOND_ID);
    const messageEvents = events.filter((item) => item.event === "message:new");
    assert.deepEqual(messageEvents.map((item) => item.payload.channel.phoneNumberId), [MAIN_ID, SECOND_ID]);
  } finally { socket.emit = originalEmit; }
});

test("mensagem, template e mídia outbound usam o phone_number_id da conversa", async () => {
  const db = createFakePrisma();
  const first = await messageService.processInboundMessage(inbound("wamid.in.main", MAIN_ID), { db });
  const second = await messageService.processInboundMessage(inbound("wamid.in.second", SECOND_ID), { db });
  const calls = [];

  await conversationService.sendText(first.conversation.id, "Principal", null, {
    db,
    sendTextMessage: async (...args) => { calls.push(["text", ...args]); return { messages: [{ id: "wamid.out.main" }] }; },
  });
  await conversationService.sendTemplate(second.conversation.id, {
    templateName: "hello_world", language: "pt_BR", components: [],
  }, null, {
    db,
    findTemplate: async () => ({ template: { status: "APPROVED", name: "hello_world", language: "pt_BR", body: { text: "Olá" } } }),
    sendTemplateMessage: async (...args) => { calls.push(["template", ...args]); return { messages: [{ id: "wamid.template.second" }] }; },
  });
  await conversationService.sendMedia(second.conversation.id, "image", { path: "ignored" }, {}, null, {
    db,
    upload: async (_file, _kind, options) => {
      calls.push(["upload", options.phoneNumberId]);
      return { mediaId: "media-second", mimeType: "image/jpeg", filename: "foto.jpg" };
    },
    sendImageMessage: async (...args) => { calls.push(["image", ...args]); return { messages: [{ id: "wamid.image.second" }] }; },
  });

  assert.equal(calls.find((item) => item[0] === "text")[4], MAIN_ID);
  assert.equal(calls.find((item) => item[0] === "template")[5], SECOND_ID);
  assert.equal(calls.find((item) => item[0] === "upload")[1], SECOND_ID);
  assert.equal(calls.find((item) => item[0] === "image")[4], SECOND_ID);
});

test("Calling inbound e outbound mantém phone_number_id e canal corretos", async () => {
  const db = createFakePrisma();
  const contacts = [{ wa_id: WA_ID, profile: { name: "Cliente" } }];
  const baseCall = {
    from: WA_ID, event: "connect", direction: "USER_INITIATED",
    timestamp: "1787800000", session: { sdp_type: "offer", sdp: "v=0\r\n" },
  };
  const main = await callService.processCallEvent({
    call: { ...baseCall, id: "wacid.main" }, contacts, phoneNumberId: MAIN_ID,
  }, { db });
  const second = await callService.processCallEvent({
    call: { ...baseCall, id: "wacid.second", timestamp: "1787800001" }, contacts, phoneNumberId: SECOND_ID,
  }, { db });
  assert.equal(main.channel.phoneNumberId, MAIN_ID);
  assert.equal(second.channel.phoneNumberId, SECOND_ID);
  assert.notEqual(main.conversationId, second.conversationId);

  const initiated = [];
  const outbound = await callService.initiate(second.conversationId, {
    agent: AGENT, session: { sdpType: "offer", sdp: "v=0\r\n" },
  }, {
    db,
    getCallPermission: async () => grantedPermission(),
    initiateCall: async (...args) => { initiated.push(args); return { calls: [{ id: "wacid.out.second" }] }; },
  });
  assert.equal(initiated[0][0], SECOND_ID);
  assert.equal(outbound.channel.phoneNumberId, SECOND_ID);
  assert.equal(db.state.calls.at(-1).channelId, 2);
});

test("canal desconhecido é ignorado sem encaminhar mensagem ou chamada", async () => {
  const received = [];
  await whatsappController.processWebhookPayload({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "9999999999999999" },
      messages: [{ id: "wamid.unknown", from: WA_ID, type: "text", text: { body: "Olá" } }],
      calls: [{ id: "wacid.unknown", event: "connect", from: WA_ID }],
    } }] }],
  }, {
    channelService: { resolveInbound: async () => null },
    messageService: { processInboundMessage: async () => received.push("message") },
    callService: { processCallEvent: async () => received.push("call") },
  });
  assert.deepEqual(received, []);
});

test("endpoint de canais expõe somente metadados seguros dos dois números", async () => {
  const db = createFakePrisma();
  const result = await channelService.listChannels(db);
  assert.deepEqual(result.data.slice(0, 2).map((item) => item.phoneNumberId), [MAIN_ID, SECOND_ID]);
  assert.equal(result.data[0].isDefault, true);
  assert.equal(JSON.stringify(result).includes("token"), false);
});
