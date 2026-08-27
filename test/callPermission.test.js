const test = require("node:test");
const assert = require("node:assert/strict");
const callService = require("../src/services/call.service");
const permissionService = require("../src/services/callPermission.service");
const whatsappController = require("../src/controllers/whatsapp.controller");
const { createFakePrisma } = require("./helpers/fakePrisma");

const AGENT = { id: "72", name: "Leonardo", director: false };
const PHONE_ID = "phone-outbound-2";
const WA_ID = "556697212427";

async function seedConversation(db) {
  const contact = await db.contact.upsert({
    where: { waId: WA_ID },
    create: { waId: WA_ID, phone: WA_ID, profileName: "Cliente" },
    update: {},
  });
  return db.conversation.create({ data: {
    contactId: contact.id,
    phoneNumberId: PHONE_ID,
    assignedUserId: AGENT.id,
    assignedUserName: AGENT.name,
    lastInboundAt: new Date(),
    customerServiceWindowExpiresAt: new Date(Date.now() + 3600000),
  } });
}

function socketRecorder() {
  const events = [];
  return {
    events,
    emitToAgents(ids, event, payload) { events.push({ ids, event, payload }); },
  };
}

function noPermission({ canRequest = true } = {}) {
  return {
    permission: { status: "no_permission" },
    actions: [
      { action_name: "send_call_permission_request", can_perform_action: canRequest },
      { action_name: "start_call", can_perform_action: false },
    ],
  };
}

function grantedPermission(expirationSeconds = Math.floor(Date.now() / 1000) + 86400) {
  return {
    permission: { status: "temporary", expiration_time: expirationSeconds },
    actions: [
      { action_name: "send_call_permission_request", can_perform_action: false },
      { action_name: "start_call", can_perform_action: true },
    ],
  };
}

function permissionWebhook(overrides = {}) {
  return {
    from: WA_ID,
    id: "wamid.permission-reply-1",
    timestamp: String(Math.floor(Date.now() / 1000)),
    context: { from: WA_ID, id: "wamid.permission-request-1" },
    type: "interactive",
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: {
        response: "accept",
        is_permanent: false,
        expiration_timestamp: String(Math.floor(Date.now() / 1000) + 86400),
        response_source: "user_action",
        ...overrides,
      },
    },
  };
}

test.beforeEach(() => { process.env.CALL_MEDIA_GATEWAY_ENABLED = "false"; });

test("solicita permissão oficial, persiste PENDING e emite atualização privada", async () => {
  const db = createFakePrisma();
  const conversation = await seedConversation(db);
  const socket = socketRecorder();
  const calls = [];
  const result = await callService.requestPermission(conversation.id, {
    agent: AGENT, body: "Podemos ligar para ajudar no seu atendimento?",
  }, {
    db, socket,
    getCallPermission: async (...args) => { calls.push(["get", ...args]); return noPermission(); },
    requestCallPermission: async (...args) => {
      calls.push(["request", ...args]);
      return { messages: [{ id: "wamid.permission-request-1" }] };
    },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(result.canCall, false);
  assert.deepEqual(calls[1].slice(1, 3), [PHONE_ID, WA_ID]);
  assert.equal(db.state.permissions[0].metaReference, "wamid.permission-request-1");
  assert.equal(socket.events[0].event, "call:permission:updated");
  assert.equal(socket.events[0].payload.status, "PENDING");
});

test("webhook call_permission_reply concede, persiste e emite sem duplicar", async () => {
  const db = createFakePrisma();
  const conversation = await seedConversation(db);
  const socket = socketRecorder();
  await permissionService.markRequested({
    conversation, phoneNumberId: PHONE_ID, agent: AGENT, messageId: "wamid.permission-request-1",
  }, { db, socket });
  socket.events.length = 0;
  const message = permissionWebhook();
  const first = await permissionService.processWebhook({
    message, contacts: [{ wa_id: WA_ID, profile: { name: "Cliente" } }], phoneNumberId: PHONE_ID,
  }, { db, socket });
  const repeated = await permissionService.processWebhook({ message, contacts: [], phoneNumberId: PHONE_ID }, { db, socket });
  assert.equal(first.permission.status, "GRANTED");
  assert.equal(first.permission.canStartCall, true);
  assert.ok(first.permission.grantedAt instanceof Date);
  assert.equal(first.permission.metaReference, "wamid.permission-request-1");
  assert.equal(repeated.duplicate, true);
  assert.equal(socket.events.length, 1);
  assert.equal(socket.events[0].payload.canCall, true);
});

test("GET sincroniza a permissão concedida e retorna contrato amigável", async () => {
  const db = createFakePrisma();
  const conversation = await seedConversation(db);
  const result = await callService.getPermission(conversation.id, AGENT, {
    db, getCallPermission: async () => grantedPermission(),
  });
  assert.equal(result.status, "GRANTED");
  assert.equal(result.canCall, true);
  assert.ok(result.expiresAt);
  assert.equal(db.state.permissions[0].phoneNumberId, PHONE_ID);
});

test("inicia outbound com permissão válida e usa o phone_number_id da conversa", async () => {
  const db = createFakePrisma();
  const conversation = await seedConversation(db);
  const invoked = [];
  const result = await callService.initiate(conversation.id, {
    agent: AGENT, session: { sdpType: "offer", sdp: "v=0\r\na=offer-permission-test\r\n" },
  }, {
    db,
    getCallPermission: async () => grantedPermission(),
    initiateCall: async (...args) => { invoked.push(args); return { calls: [{ id: "wacid.outbound-permission-1" }] }; },
  });
  assert.equal(result.direction, "OUTBOUND");
  assert.equal(result.status, "CONNECTING");
  assert.deepEqual(invoked[0].slice(0, 2), [PHONE_ID, WA_ID]);
});

test("bloqueia outbound sem permissão e com permissão expirada", async () => {
  for (const meta of [noPermission(), grantedPermission(Math.floor(Date.now() / 1000) - 10)]) {
    const db = createFakePrisma();
    const conversation = await seedConversation(db);
    await assert.rejects(
      () => callService.initiate(conversation.id, {
        agent: AGENT, session: { sdpType: "offer", sdp: "v=0\r\na=offer-permission-test\r\n" },
      }, { db, getCallPermission: async () => meta }),
      (error) => error.status === 409 && error.publicCode === "CALL_PERMISSION_REQUIRED"
        && error.message === "O cliente ainda não autorizou ligações.",
    );
  }
});

test("erro da Meta ao solicitar não cria permissão PENDING", async () => {
  const db = createFakePrisma();
  const conversation = await seedConversation(db);
  await assert.rejects(
    () => callService.requestPermission(conversation.id, { agent: AGENT }, {
      db,
      getCallPermission: async () => noPermission(),
      requestCallPermission: async () => { throw new Error("Meta indisponível"); },
    }),
    /Meta indisponível/,
  );
  assert.equal(db.state.permissions[0].status, "DENIED");
  assert.equal(db.state.permissions.some((item) => item.status === "PENDING"), false);
});

test("controller reconhece o webhook oficial no campo messages", async () => {
  const received = [];
  await whatsappController.processWebhookPayload({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: PHONE_ID },
      contacts: [{ wa_id: WA_ID }], messages: [permissionWebhook()],
    } }] }],
  }, {
    channelService: { resolveInbound: async () => ({ id: 5, phoneNumberId: PHONE_ID, isActive: true }) },
    callService: {
      isCallPermissionReply: permissionService.isPermissionReply,
      processCallPermission: async (value) => received.push(["permission", value]),
    },
    messageService: { processInboundMessage: async (value) => received.push(["message", value]) },
  });
  assert.deepEqual(received.map(([type]) => type), ["permission", "message"]);
});
