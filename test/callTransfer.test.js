const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const callService = require("../src/services/call.service");
const transferService = require("../src/services/callTransfer.service");
const presence = require("../src/services/callPresence.service");
const { verifyAgentToken, AUDIENCE, ISSUER } = require("../src/utils/agentToken");
const { createFakePrisma } = require("./helpers/fakePrisma");

const CALL_ID = "wacid.transfer-test-1";
const PHONE_ID = "phone-transfer";
const A = { id: "10", name: "Michele" };
const B = { id: "20", name: "Nataly" };

function socketRecorder() {
  const events = [];
  return {
    events,
    emitToAgent: (agentId, event, payload) => events.push({ agentIds: [String(agentId)], event, payload }),
    emitToAgents: (agentIds, event, payload) => events.push({ agentIds: agentIds.map(String), event, payload }),
  };
}

async function seedActiveCall(db) {
  await callService.processCallEvent({
    phoneNumberId: PHONE_ID,
    contacts: [{ wa_id: "556697212427", profile: { name: "Cliente" } }],
    call: {
      id: CALL_ID, from: "556697212427", event: "connect", direction: "USER_INITIATED",
      timestamp: "1787600000", session: { sdp_type: "offer", sdp: "v=0\r\nmock offer" },
    },
  }, { db });
  const call = db.state.calls[0];
  call.status = "ACTIVE";
  call.currentAgentId = A.id;
  call.currentAgentName = A.name;
  const conversation = db.state.conversations.find((item) => item.id === call.conversationId);
  conversation.assignedUserId = A.id;
  conversation.assignedUserName = A.name;
  return call;
}

test.beforeEach(() => presence.reset());

test("A solicita transferência e somente B recebe o evento privado", async () => {
  const db = createFakePrisma();
  await seedActiveCall(db);
  presence.connect(B, "socket-b");
  const socket = socketRecorder();
  const result = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket });
  assert.equal(result.status, "PENDING");
  assert.equal(result.toAgent.id, B.id);
  assert.deepEqual(socket.events[0].agentIds, [B.id]);
  assert.equal(socket.events[0].event, "call:transfer:incoming");
  assert.equal(db.state.transfers.length, 1);
});

test("currentAgent muda somente após B aceitar e a mídia estar pronta", async () => {
  const db = createFakePrisma();
  await seedActiveCall(db);
  presence.connect(B, "socket-b");
  const socket = socketRecorder();
  const pending = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket });
  await transferService.acceptTransfer(CALL_ID, pending.transferId, B, { db, socket });
  assert.equal(db.state.calls[0].currentAgentId, A.id);
  const gatewayCalls = [];
  const gateway = {
    agentReady: async () => ({ ready: true }),
    setCurrentAgent: async (...args) => { gatewayCalls.push(["switch", ...args]); return { previousAgentId: A.id }; },
    removeAgent: async (...args) => { gatewayCalls.push(["remove", ...args]); },
  };
  const completed = await transferService.completeTransfer(CALL_ID, pending.transferId, B, {
    db, socket, mediaGateway: gateway,
  });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(db.state.calls[0].currentAgentId, B.id);
  assert.equal(db.state.conversations[0].assignedUserId, B.id);
  assert.deepEqual(gatewayCalls.map((item) => item[0]), ["switch", "remove"]);
  assert.ok(socket.events.some((item) => item.event === "call:transferred:away" && item.agentIds[0] === A.id));
  assert.ok(socket.events.some((item) => item.event === "call:transfer:completed" && item.agentIds[0] === B.id));
});

test("não conclui handoff enquanto o áudio de B não estiver pronto", async () => {
  const db = createFakePrisma();
  await seedActiveCall(db);
  presence.connect(B, "socket-b");
  const pending = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() });
  await transferService.acceptTransfer(CALL_ID, pending.transferId, B, { db, socket: socketRecorder() });
  await assert.rejects(
    () => transferService.completeTransfer(CALL_ID, pending.transferId, B, {
      db, socket: socketRecorder(), mediaGateway: { agentReady: async () => ({ ready: false }) },
    }),
    (error) => error.publicCode === "MEDIA_NOT_READY",
  );
  assert.equal(db.state.calls[0].currentAgentId, A.id);
});

test("B recusa e A cancela sem alterar a chamada ativa", async () => {
  for (const action of ["rejectTransfer", "cancelTransfer"]) {
    const db = createFakePrisma();
    await seedActiveCall(db);
    presence.connect(B, "socket-b");
    const socket = socketRecorder();
    const pending = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket });
    const actor = action === "rejectTransfer" ? B : A;
    const result = await transferService[action](CALL_ID, pending.transferId, actor, {
      db, socket, mediaGateway: { removeAgent: async () => {} },
    });
    assert.equal(result.status, action === "rejectTransfer" ? "REJECTED" : "CANCELLED");
    assert.equal(db.state.calls[0].currentAgentId, A.id);
  }
});

test("rejeita target offline, ocupado e segunda transferência simultânea", async () => {
  const db = createFakePrisma();
  await seedActiveCall(db);
  await assert.rejects(
    () => transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() }),
    (error) => error.publicCode === "AGENT_OFFLINE",
  );
  presence.connect(B, "socket-b");
  presence.markBusy(B.id, "wacid.other");
  await assert.rejects(
    () => transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() }),
    (error) => error.publicCode === "AGENT_BUSY",
  );
  presence.clearBusy(B.id, "wacid.other");
  await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() });
  await assert.rejects(
    () => transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() }),
    (error) => error.publicCode === "AGENT_BUSY",
  );
});

test("timeout e encerramento cancelam handoff sem terminar novamente a chamada Meta", async () => {
  const db = createFakePrisma();
  const call = await seedActiveCall(db);
  presence.connect(B, "socket-b");
  const socket = socketRecorder();
  const pending = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket });
  db.state.transfers[0].expiresAt = new Date(Date.now() - 1000);
  const expired = await transferService.expireDueTransfers({
    db, socket, mediaGateway: { removeAgent: async () => {} },
  });
  assert.equal(expired, 1);
  assert.equal(db.state.transfers[0].status, "EXPIRED");

  db.state.transfers.length = 0;
  await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket });
  await transferService.cancelForEndedCall(call, { db, socket });
  assert.equal(db.state.transfers[0].status, "CANCELLED");
});

test("ações de transferência validam a identidade autenticada", async () => {
  const db = createFakePrisma();
  await seedActiveCall(db);
  presence.connect(B, "socket-b");
  const pending = await transferService.requestTransfer(CALL_ID, B.id, A, { db, socket: socketRecorder() });
  await assert.rejects(
    () => transferService.acceptTransfer(CALL_ID, pending.transferId, { id: "99", name: "Intruso" }, {
      db, socket: socketRecorder(),
    }),
    (error) => error.status === 403,
  );
});

test("token HMAC fornece identidade confiável e rejeita adulteração", () => {
  const secret = "segredo-de-teste-comprido-com-32-caracteres";
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER, aud: AUDIENCE, sub: A.id, name: A.name, iat: now, exp: now + 60,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  assert.deepEqual(verifyAgentToken(`${payload}.${signature}`, secret), {
    id: A.id, name: A.name, director: false, environment: "production",
  });
  assert.throws(() => verifyAgentToken(`${payload}.${signature}x`, secret));
});

test("token preserva o ambiente que receberá chamadas", () => {
  const secret = "segredo-de-teste-comprido-com-32-caracteres";
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER, aud: AUDIENCE, sub: A.id, name: A.name,
    environment: "LOCAL", iat: now, exp: now + 60,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  assert.equal(verifyAgentToken(`${payload}.${signature}`, secret).environment, "local");
});
