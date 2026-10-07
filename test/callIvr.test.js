const test = require("node:test");
const assert = require("node:assert/strict");
const { createIvr, validateConfig, configure } = require("../src/services/callIvr.service");
const { createFakePrisma } = require("./helpers/fakePrisma");

const config = validateConfig({ enabled: true, options: {
  1: { name: "Financeiro", agentIds: ["72"] },
  2: { name: "Vendas", agentIds: ["116"] },
  3: { name: "Compras", agentIds: ["155"] },
} });

function fixture() {
  let now = 100000;
  let call = { metaCallId: "call", channelId: 1, phoneNumberId: "phone", status: "RINGING", channel: { callIvrConfig: config } };
  const events = [], actions = [], digits = [];
  const online = ["72", "116", "155", "99"];
  const versions = {};
  const ivr = createIvr({
    now: () => now,
    repo: {
      update: async (_id, data) => { call = { ...call, ...data }; return call; },
      findByMetaCallId: async () => call,
    },
    gateway: {
      getMetaSession: async () => ({ sdp: "same-answer" }),
      waitForMetaReady: async () => ({ ready: true }),
      playIvr: async (_id, menu) => actions.push(["audio", menu]),
      getIvr: async () => ({ digits }), closeCall: async () => actions.push(["close"]),
    },
    whatsapp: {
      preAcceptCall: async (_phone, _call, sdp) => actions.push(["pre_accept", sdp]),
      acceptCall: async (_phone, _call, sdp) => actions.push(["accept", sdp]),
      terminateCall: async () => actions.push(["terminate"]),
    },
    presence: { availableForChannel: () => online, connectionVersion: (id) => versions[id] || 1,
      list: () => online.map((id) => ({ id, online: true })) },
    socket: { emitToAgents: (ids, event, payload) => events.push({ ids, event, payload }) },
  });
  return { ivr, online, versions, digits, events, actions, call: () => call, advance: (ms) => { now += ms; } };
}

test("URA toca antes de notificar e encaminha 1 ao Financeiro sem novo aceite", async () => {
  const f = fixture();
  await f.ivr.start(f.call(), config);
  assert.equal(f.events.length, 0);
  const signals = f.actions.filter(([action]) => ["accept", "pre_accept"].includes(action));
  assert.deepEqual(signals, [["pre_accept", "same-answer"], ["accept", "same-answer"]]);
  assert.throws(() => f.ivr.guard(f.call(), { id: "72" }), { status: 403 });
  f.digits.push({ id: 1, digit: "1" });
  await f.ivr.tick("call");
  assert.deepEqual(f.events[0].ids, ["72"]);
  assert.equal(f.events[0].payload.status, "RINGING");
  f.ivr.guard(f.call(), { id: "72" });
  assert.throws(() => f.ivr.guard(f.call(), { id: "116" }), { status: 403 });
});

test("9 repete a gravação uma vez mesmo recebendo o mesmo evento novamente", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "9" });
  await f.ivr.tick("call"); await f.ivr.tick("call");
  assert.equal(f.actions.filter(([action, menu]) => action === "audio" && menu).length, 2);
  assert.equal(f.events.length, 0);
});

test("amplia o toque após 25 segundos sem repetir o aviso aos membros do setor", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "2" }); await f.ivr.tick("call");
  f.advance(24999); await f.ivr.tick("call"); assert.equal(f.events.length, 1);
  f.advance(1); await f.ivr.tick("call");
  assert.deepEqual(f.events[1].ids, ["72", "155", "99"]);
  assert.equal(f.call().ivrState.fallback, true);
});

test("setor sem ninguém disponível encaminha imediatamente aos demais", async () => {
  const f = fixture(); f.online.splice(f.online.indexOf("155"), 1);
  await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "3" }); await f.ivr.tick("call");
  assert.deepEqual(f.events[0].ids, ["72", "116", "99"]);
});

test("recusa de um atendente não derruba a ligação e libera o encaminhamento geral", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "1" }); await f.ivr.tick("call");
  await f.ivr.decline(f.call(), { id: "72" }); await f.ivr.tick("call");
  assert.equal(f.call().status, "ACTIVE");
  assert.deepEqual(f.events[1].ids, ["116", "155", "99"]);
  assert.equal(f.actions.some(([action]) => action === "terminate"), false);
});

test("sem escolha encaminha aos disponíveis e encerra após o limite de espera", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "7" }); f.advance(45000); await f.ivr.tick("call");
  assert.deepEqual(f.events[0].ids, f.online);
  f.advance(75000); await f.ivr.tick("call");
  assert.equal(f.call().endReason, "IVR_QUEUE_TIMEOUT");
  assert.deepEqual(f.ivr.ids(), []);
});

test("reconexão recebe a oferta pendente e chamada encerrada não toca novamente", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.digits.push({ id: 1, digit: "1" }); await f.ivr.tick("call");
  f.versions["72"] = 2; await f.ivr.tick("call"); assert.equal(f.events.length, 2);
  f.call().status = "ENDED"; await f.ivr.tick("call");
  assert.deepEqual(f.ivr.ids(), []); assert.equal(f.events.length, 2);
});

test("reinício recupera fila sem repetir aceite e configuração local não sobrescreve produção", async () => {
  const f = fixture(); await f.ivr.start(f.call(), config);
  f.ivr.finish("call"); await f.ivr.recover([f.call()]); await f.ivr.tick("call");
  assert.equal(f.call().ivrState.fallback, true);
  assert.equal(f.actions.filter(([action]) => action === "accept").length, 1);
  await assert.rejects(configure(1, config, { director: true, environment: "local" }, createFakePrisma()), { status: 403 });
  assert.throws(() => validateConfig({ enabled: true, options: {} }), { status: 400 });
});

test("não reativa a chamada se o cliente encerrar durante o aceite da URA", async () => {
  const db = createFakePrisma();
  const repo = require("../src/repositories/call.repository");
  const initial = await repo.create({ metaCallId: "ended-call", channelId: 1, status: "RINGING" }, db);
  let menuPlayed = false;
  const ivr = createIvr({
    repo: {
      update: (id, data) => repo.update(id, data, db),
      updateUnclaimed: (id, data) => repo.updateUnclaimed(id, data, db),
      findByMetaCallId: (id) => repo.findByMetaCallId(id, db),
    },
    gateway: { getMetaSession: async () => ({ sdp: "answer" }), waitForMetaReady: async () => ({ ready: true }),
      playIvr: async (_id, menu) => { if (menu) menuPlayed = true; } },
    whatsapp: { preAcceptCall: async () => {}, acceptCall: async () => { await repo.update("ended-call", { status: "ENDED" }, db); } },
  });
  await ivr.start(initial, config);
  assert.equal(db.state.calls[0].status, "ENDED");
  assert.equal(menuPlayed, false);
  assert.deepEqual(ivr.ids(), []);
});

test("fallback respeita permissões do número e exclui atendentes ocupados", () => {
  const presence = require("../src/services/callPresence.service");
  presence.reset();
  try {
    presence.connect({ id: "72", name: "Permitido", channelIds: ["1"] }, "a");
    presence.connect({ id: "116", name: "Outro canal", channelIds: ["2"] }, "b");
    presence.connect({ id: "155", name: "Ocupado", channelIds: ["1"] }, "c");
    presence.markBusy("155", "other-call");
    assert.deepEqual(presence.availableForChannel(1), ["72"]);
  } finally { presence.reset(); }
});
