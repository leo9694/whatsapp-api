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

test("connect inbound repetido com outro timestamp não prepara novamente o gateway", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const originalEnabled = process.env.CALL_MEDIA_GATEWAY_ENABLED;
  process.env.CALL_MEDIA_GATEWAY_ENABLED = "true";
  let preparations = 0;
  try {
    const result = await callService.processCallEvent({
      call: inboundCall({ timestamp: "1787600001" }), phoneNumberId: PHONE_ID,
    }, { db, prepareInbound: async () => { preparations += 1; } });
    assert.equal(result.duplicate, true);
    assert.equal(preparations, 0);
    assert.equal(db.state.calls[0].status, "RINGING");
  } finally {
    if (originalEnabled === undefined) delete process.env.CALL_MEDIA_GATEWAY_ENABLED;
    else process.env.CALL_MEDIA_GATEWAY_ENABLED = originalEnabled;
  }
});

test("connect e ringing atrasados não reabrem uma chamada ativa ou encerrada", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  await callService.processCallStatus({ status: {
    id: CALL_ID, type: "call", status: "accepted", timestamp: "1787600002",
  } }, { db });
  const ringing = await callService.processCallStatus({ status: {
    id: CALL_ID, type: "call", status: "ringing", timestamp: "1787600003",
  } }, { db });
  assert.equal(ringing.ignored, true);
  assert.equal((await createInbound(db, inboundCall({ timestamp: "1787600004" }))).call.status, "ACTIVE");
  await callService.processCallEvent({
    call: inboundCall({ event: "terminate", timestamp: "1787600005" }), phoneNumberId: PHONE_ID,
  }, { db });
  assert.equal((await createInbound(db, inboundCall({ timestamp: "1787600006" }))).call.status, "ENDED");
  const lateAccepted = await callService.processCallStatus({ status: {
    id: CALL_ID, type: "call", status: "accepted", timestamp: "1787600007",
  } }, { db });
  assert.equal(lateAccepted.call.status, "ENDED");
});

test("impede dois aceites simultâneos e libera a trava após falha de mídia", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const pending = callService.mediaReady(CALL_ID, {}, agent, {
    db, mediaGateway: { waitForAgentReady: () => ready },
  });
  await assert.rejects(callService.mediaReady(CALL_ID, {}, agent, { db }), /já está em andamento/);
  resolveReady({ ready: false });
  await assert.rejects(pending, /ainda não está pronto/);
  await assert.rejects(callService.mediaReady(CALL_ID, {}, agent, {
    db, mediaGateway: { waitForAgentReady: async () => ({ ready: false }) },
  }), /ainda não está pronto/);
});

test("não pré-aceita uma chamada encerrada enquanto aguardava o microfone", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  let preAccepted = false;
  await assert.rejects(callService.mediaReady(CALL_ID, {}, agent, {
    db,
    mediaGateway: {
      waitForAgentReady: async () => {
        await db.call.update({ where: { metaCallId: CALL_ID }, data: { status: "ENDED" } });
        return { ready: true };
      },
    },
    preAcceptCall: async () => { preAccepted = true; },
  }), /estado ENDED/);
  assert.equal(preAccepted, false);
  assert.equal(db.state.calls[0].status, "ENDED");
});

test("repetir media-ready após resposta perdida não aceita novamente a chamada", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  await db.call.update({ where: { metaCallId: CALL_ID }, data: {
    status: "ACTIVE", currentAgentId: agent.id, currentAgentName: agent.name,
  } });
  let accepted = false;
  const result = await callService.mediaReady(CALL_ID, {}, agent, {
    db, acceptCall: async () => { accepted = true; },
  });
  assert.equal(result.status, "ACTIVE");
  assert.equal(accepted, false);
});

test("status recebido no mesmo segundo da criação outbound não é descartado como antigo", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  await db.call.update({ where: { metaCallId: CALL_ID }, data: {
    direction: "OUTBOUND", status: "CONNECTING", lastEventAt: new Date(1787600001950),
  } });
  const result = await callService.processCallStatus({ status: {
    id: CALL_ID, type: "call", status: "accepted", timestamp: "1787600001",
  } }, { db });
  assert.equal(result.status, "ACTIVE");
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
    channelService: { resolveInbound: async () => ({ id: 3, phoneNumberId: PHONE_ID, isActive: true }) },
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

test("preserva a perna Meta em negociação e sinaliza o mesmo SDP quando o atendente está pronto", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const actions = [];
  let repaired = false;
  let readinessChecks = 0;
  const active = await callService.mediaReady(CALL_ID, {}, agent, {
    db,
    mediaGateway: {
      waitForAgentReady: async () => ({ ready: true, lastRtpAgeMs: 10 }),
      getMetaSession: async () => ({ sdp: ANSWER, ready: false, peerState: "connecting", iceState: "connected" }),
      repairMetaSession: async () => { repaired = true; return { sdp: `${ANSWER}a=x-repaired\r\n`, repaired: true }; },
      waitForMetaReady: async () => { readinessChecks += 1; actions.push("ready"); return { ready: true, peerState: "connected" }; },
      setCurrentAgent: async () => { actions.push("current"); },
      removeAgent: async () => {},
      closeCall: async () => {},
    },
    preAcceptCall: async (_phone, _callId, sdp) => { actions.push(["pre_accept", sdp]); },
    acceptCall: async (_phone, _callId, sdp) => { actions.push(["accept", sdp]); },
  });
  assert.equal(active.status, "ACTIVE");
  assert.deepEqual(actions.map((item) => Array.isArray(item) ? item[0] : item), ["pre_accept", "ready", "accept", "ready", "current"]);
  const signals = actions.filter(Array.isArray);
  assert.equal(signals[0][1], signals[1][1]);
  assert.equal(signals[0][1], ANSWER);
  assert.equal(repaired, false);
  assert.equal(readinessChecks, 2);
});

test("recria a perna Meta fechada antes do único pré-aceite", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const actions = [];
  const repairedAnswer = `${ANSWER}a=x-repaired\r\n`;
  const active = await callService.mediaReady(CALL_ID, {}, agent, {
    db,
    mediaGateway: {
      waitForAgentReady: async () => ({ ready: true, lastRtpAgeMs: 10 }),
      getMetaSession: async () => ({ sdp: ANSWER, ready: false, peerState: "closed" }),
      repairMetaSession: async () => ({ sdp: repairedAnswer, repaired: true }),
      waitForMetaReady: async () => { actions.push("ready"); return { ready: true, peerState: "connected" }; },
      setCurrentAgent: async () => { actions.push("current"); },
      removeAgent: async () => {},
      closeCall: async () => {},
    },
    preAcceptCall: async (_phone, _callId, sdp) => { actions.push(["pre_accept", sdp]); },
    acceptCall: async (_phone, _callId, sdp) => { actions.push(["accept", sdp]); },
  });
  assert.equal(active.status, "ACTIVE");
  assert.deepEqual(actions.map((item) => Array.isArray(item) ? item[0] : item), ["pre_accept", "ready", "accept", "ready", "current"]);
  const signals = actions.filter(Array.isArray);
  assert.equal(signals[0][1], repairedAnswer);
  assert.equal(signals[1][1], repairedAnswer);
});

test("não aceita a chamada antes de a mídia Meta ficar pronta", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  let accepted = false;
  await assert.rejects(callService.mediaReady(CALL_ID, {}, agent, {
    db,
    mediaGateway: {
      waitForAgentReady: async () => ({ ready: true, lastRtpAgeMs: 10 }),
      getMetaSession: async () => ({ sdp: ANSWER, ready: true, peerState: "connecting" }),
      waitForMetaReady: async () => ({ ready: false, peerState: "connecting" }),
      removeAgent: async () => {},
      closeCall: async () => {},
    },
    preAcceptCall: async () => {},
    acceptCall: async () => { accepted = true; },
    rejectCall: async () => {},
  }), (error) => error.publicCode === "META_MEDIA_NOT_READY");
  assert.equal(accepted, false);
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

test("encerramento da Meta preserva falha de áudio registrada pela API", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  db.state.calls[0].status = "FAILED";
  db.state.calls[0].endReason = "META_MEDIA_NOT_READY";
  const result = await callService.processCallEvent({
    call: inboundCall({ event: "terminate", status: "COMPLETED", timestamp: "1787600010", session: undefined }),
    phoneNumberId: PHONE_ID,
  }, { db });
  assert.equal(result.status, "FAILED");
  assert.equal(db.state.calls[0].endReason, "META_MEDIA_NOT_READY");
});

test("atendente conecta a chamada já aceita pela URA sem renegociar ou aceitar novamente na Meta", async () => {
  const db = createFakePrisma();
  await createInbound(db);
  const channel = db.state.channels.find((c) => c.phoneNumberId === PHONE_ID);
  channel.callIvrConfig = { enabled: true, options: { 1: { agentIds: [agent.id] } } };
  const presence = require("../src/services/callPresence.service");
  presence.connect(agent, "ivr-test");
  Object.assign(db.state.calls[0], { status: "ACTIVE", answeredAt: new Date(),
    ivrState: { phase: "QUEUE", option: "1", fallback: false, accepted: true } });
  let routed = false;
  try {
    const active = await callService.mediaReady(CALL_ID, {}, agent, {
      db,
      mediaGateway: {
        waitForAgentReady: async () => ({ ready: true }),
        getMetaSession: async () => ({ ready: true, sdp: ANSWER }),
        waitForMetaReady: async () => ({ ready: true }),
        setCurrentAgent: async () => { routed = true; },
        removeAgent: async () => {},
      },
      preAcceptCall: async () => { throw new Error("URA já pré-aceitou"); },
      acceptCall: async () => { throw new Error("URA já aceitou"); },
    });
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.ivr.phase, "AGENT");
    assert.equal(routed, true);
  } finally { presence.reset(); }
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

test("impede nova ligação para conversa que já tem uma chamada chamando", async () => {
  const db = createFakePrisma();
  const incoming = await createInbound(db);
  let contactedMeta = false;
  await assert.rejects(callService.initiate(incoming.conversationId, { agent }, {
    db, getCallPermission: async () => { contactedMeta = true; },
  }), (error) => error.publicCode === "CALL_ALREADY_ACTIVE");
  assert.equal(contactedMeta, false);
});

test("impede ligações simultâneas do mesmo atendente antes de consultar a Meta", async () => {
  const db = createFakePrisma();
  const { conversation } = await seedConversation(db);
  let resolvePermission;
  const reachedPermission = new Promise((resolve) => {
    const pending = callService.initiate(conversation.id, { agent }, {
      db, getCallPermission: () => {
        resolve();
        return new Promise((done) => { resolvePermission = done; });
      },
    });
    pending.catch(() => {});
    db.pending = pending;
  });
  await reachedPermission;
  await assert.rejects(callService.initiate(conversation.id, { agent }, { db }),
    (error) => error.publicCode === "AGENT_BUSY");
  resolvePermission({ actions: [] });
  await assert.rejects(db.pending, (error) => error.publicCode === "CALL_PERMISSION_REQUIRED");
});
