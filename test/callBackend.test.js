const test = require("node:test");
const assert = require("node:assert/strict");

const callService = require("../src/services/call.service");
const whatsappController = require("../src/controllers/whatsapp.controller");
const contactRepository = require("../src/repositories/contact.repository");
const conversationRepository = require("../src/repositories/conversation.repository");
const socket = require("../src/sockets/socket");
const { answerActionSchema } = require("../src/validators/call.validator");
const { createFakePrisma } = require("./helpers/fakePrisma");

const agent = { id: "agent-1", name: "Leonardo", signature: "Leonardo" };
const PHONE_ID = "phone-number-id-2";
const CALL_ID = "wacid.inbound-test-1";
const OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

function inboundCall(overrides = {}) {
  return {
    id: CALL_ID,
    from: "556697212427",
    to: "556699999999",
    event: "connect",
    direction: "USER_INITIATED",
    timestamp: "1787600000",
    session: { sdp_type: "offer", sdp: OFFER },
    ...overrides,
  };
}

function contacts() {
  return [{ wa_id: "556697212427", profile: { name: "Cliente teste" } }];
}

async function createInbound(db, call = inboundCall()) {
  return callService.processCallEvent({ call, contacts: contacts(), phoneNumberId: PHONE_ID }, { db });
}

async function seedConversation(db, phoneNumberId = PHONE_ID) {
  const contact = await contactRepository.upsertByWaId({
    waId: "556697212427", phone: "556697212427", name: "Cliente teste",
  }, db);
  const conversation = await conversationRepository.createForContact(contact.id, db, phoneNumberId);
  return { contact, conversation: await conversationRepository.findById(conversation.id, db) };
}

test("webhook inbound cria Call, associa conversa e emite chamada e SDP sem persistir SDP", async () => {
  const db = createFakePrisma();
  const events = [];
  const originalEmit = socket.emit;
  socket.emit = (event, payload) => events.push({ event, payload });
  try {
    const result = await createInbound(db);
    assert.equal(result.status, "RINGING");
    assert.equal(result.direction, "INBOUND");
    assert.equal(result.phoneNumberId, PHONE_ID);
    assert.equal(db.state.calls.length, 1);
    assert.equal(db.state.calls[0].sdp, undefined);
    assert.ok(result.conversationId);
    assert.ok(events.some((item) => item.event === "call:incoming"));
    const signal = events.find((item) => item.event === "call:signal");
    assert.equal(signal.payload.session.sdpType, "offer");
    assert.equal(signal.payload.session.sdp, OFFER);
    assert.equal("session" in events.find((item) => item.event === "call:incoming").payload, false);
  } finally { socket.emit = originalEmit; }
});

test("evento repetido com mesmo call_id e timestamp é idempotente", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const duplicate = await createInbound(db);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.state.calls.length, 1);
});

test("status de chamada da Meta atualiza ringing, active e rejected de forma idempotente", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const ringing = await callService.processCallStatus({
    phoneNumberId: PHONE_ID, status: { id: CALL_ID, type: "call", status: "ringing", timestamp: "1787600001" },
  }, { db });
  assert.equal(ringing.status, "RINGING");
  const active = await callService.processCallStatus({
    phoneNumberId: PHONE_ID, status: { id: CALL_ID, type: "call", status: "accepted", timestamp: "1787600002" },
  }, { db });
  assert.equal(active.status, "ACTIVE");
  assert.ok(active.answeredAt);
  const rejected = await callService.processCallStatus({
    phoneNumberId: PHONE_ID, status: { id: CALL_ID, type: "call", status: "rejected", timestamp: "1787600003" },
  }, { db });
  assert.equal(rejected.status, "REJECTED");
});

test("controller do webhook reconhece calls[] e preserva o processamento de mensagens", async () => {
  const received = [];
  await whatsappController.processWebhookPayload({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "calls", value: {
      metadata: { phone_number_id: PHONE_ID }, contacts: contacts(), calls: [inboundCall()], messages: [{ id: "wamid.1", from: "556697212427" }],
    } }] }],
  }, {
    callService: { processCallEvent: async (value) => received.push(["call", value]) },
    messageService: {
      processInboundMessage: async (value) => received.push(["message", value]),
      processStatus: async () => {},
    },
  });
  assert.deepEqual(received.map((item) => item[0]), ["message", "call"]);
  assert.equal(received[1][1].phoneNumberId, PHONE_ID);
});

test("pré-aceita e aceita com o mesmo SDP answer usando o contrato oficial", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const calls = [];
  const input = { session: { sdpType: "answer", sdp: ANSWER }, agent };
  const connecting = await callService.preAccept(CALL_ID, input, {
    db, preAcceptCall: async (...args) => calls.push(["pre_accept", ...args]),
  });
  assert.equal(connecting.status, "CONNECTING");
  const active = await callService.accept(CALL_ID, input, {
    db, acceptCall: async (...args) => calls.push(["accept", ...args]),
  });
  assert.equal(active.status, "ACTIVE");
  assert.ok(active.answeredAt);
  assert.deepEqual(calls.map((item) => item[0]), ["pre_accept", "accept"]);
  assert.equal(calls[0][1], PHONE_ID);
});

test("rejeita chamada recebida e encerra chamada ativa calculando duração desde answeredAt", async () => {
  const rejectedDb = createFakePrisma();
  await createInbound(rejectedDb);
  const rejected = await callService.reject(CALL_ID, { agent }, { db: rejectedDb, rejectCall: async () => ({ success: true }) });
  assert.equal(rejected.status, "REJECTED");

  const activeDb = createFakePrisma();
  await createInbound(activeDb);
  await callService.accept(CALL_ID, { session: { sdpType: "answer", sdp: ANSWER }, agent }, {
    db: activeDb, acceptCall: async () => ({ success: true }),
  });
  activeDb.state.calls[0].answeredAt = new Date(Date.now() - 5000);
  const ended = await callService.terminate(CALL_ID, { agent }, { db: activeDb, terminateCall: async () => ({ success: true }) });
  assert.equal(ended.status, "ENDED");
  assert.ok(ended.durationSeconds >= 5);
});

test("webhook terminate usa duração oficial e normaliza falha", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const ended = await callService.processCallEvent({
    phoneNumberId: PHONE_ID,
    contacts: contacts(),
    call: inboundCall({ event: "terminate", status: "COMPLETED", timestamp: "1787600120", start_time: "1787600010", end_time: "1787600110", duration: 100, session: undefined }),
  }, { db });
  assert.equal(ended.status, "ENDED");
  assert.equal(ended.durationSeconds, 100);

  const failedDb = createFakePrisma();
  const failed = await callService.processCallEvent({
    phoneNumberId: PHONE_ID,
    contacts: contacts(),
    errors: [{ message: "Relay connection failed" }],
    call: inboundCall({ event: "terminate", status: "FAILED", session: undefined }),
  }, { db: failedDb });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.endReason, "Relay connection failed");
});

test("erro da Meta não muda estado local da chamada", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  await assert.rejects(
    () => callService.reject(CALL_ID, { agent }, { db, rejectCall: async () => { throw new Error("Meta indisponível"); } }),
    /Meta indisponível/,
  );
  assert.equal(db.state.calls[0].status, "RINGING");
});

test("outro atendente não controla chamada de conversa já atribuída", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  db.state.conversations[0].assignedUserId = "agent-owner";
  db.state.conversations[0].assignedUserName = "Responsável";
  await assert.rejects(
    () => callService.reject(CALL_ID, { agent: { id: "agent-other", name: "Outro" } }, {
      db, rejectCall: async () => ({ success: true }),
    }),
    (error) => error.status === 403,
  );
  assert.equal(db.state.calls[0].status, "RINGING");
});

test("outbound exige permissão e usa phone_number_id da conversa", async () => {
  const db = createFakePrisma();
  const { conversation } = await seedConversation(db, "phone-number-id-channel-B");
  await assert.rejects(
    () => callService.initiate(conversation.id, { session: { sdpType: "offer", sdp: OFFER }, agent }, {
      db, getCallPermission: async () => ({ permission: { status: "no_permission" }, actions: [{ action_name: "start_call", can_perform_action: false }] }),
    }),
    (error) => error.publicCode === "CALL_PERMISSION_REQUIRED",
  );

  const invoked = [];
  const call = await callService.initiate(conversation.id, { session: { sdpType: "offer", sdp: OFFER }, agent }, {
    db,
    getCallPermission: async (...args) => { invoked.push(["permission", ...args]); return { actions: [{ action_name: "start_call", can_perform_action: true }] }; },
    initiateCall: async (...args) => { invoked.push(["connect", ...args]); return { calls: [{ id: "wacid.outbound-1" }] }; },
  });
  assert.equal(call.direction, "OUTBOUND");
  assert.equal(call.phoneNumberId, "phone-number-id-channel-B");
  assert.equal(invoked[1][1], "phone-number-id-channel-B");
});

test("validação rejeita SDP inválido", () => {
  assert.throws(() => answerActionSchema.parse({ session: { sdpType: "answer", sdp: "x" }, agent }));
});
