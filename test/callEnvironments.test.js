const test = require("node:test");
const assert = require("node:assert/strict");
const calls = require("../src/services/call.service");
const sessions = require("../src/services/callSessionStore");
const { createFakePrisma } = require("./helpers/fakePrisma");

const production = { id: "72", name: "Ana", environment: "production", clientId: "browser-production" };
const local = { ...production, environment: "local", clientId: "browser-local" };
const CALL_ID = "wacid.shared-environments";

async function fixture() {
  sessions.remove(CALL_ID);
  const db = createFakePrisma();
  await calls.processCallEvent({
    call: {
      id: CALL_ID, from: "5566999990000", direction: "USER_INITIATED", event: "connect",
      timestamp: "1787600000", session: { sdp_type: "offer", sdp: "v=0\r\nmock-offer" },
    }, contacts: [], phoneNumberId: "phone-number-id-2",
  }, { db });
  return db;
}

test("somente um ambiente reivindica a chamada mesmo com o mesmo atendente", async () => {
  const db = await fixture();
  const results = await Promise.allSettled([
    calls.claimCall(CALL_ID, production, { db }), calls.claimCall(CALL_ID, local, { db }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.find((item) => item.status === "rejected").reason.publicCode, "CALL_SESSION_CONFLICT");
  assert.equal(sessions.get(CALL_ID).environment, "production");
  assert.deepEqual(await calls.claimCall(CALL_ID, production, { db }), results[0].value);
});

test("teste não substitui o peer de produção nem encerra sua chamada", async () => {
  const db = await fixture();
  await calls.claimCall(CALL_ID, production, { db });
  const original = process.env.CALL_MEDIA_GATEWAY_ENABLED;
  process.env.CALL_MEDIA_GATEWAY_ENABLED = "true";
  let joins = 0;
  let terminations = 0;
  try {
    await calls.joinMedia(CALL_ID, { session: { sdp: "offer" } }, production, {
      db, joinAgent: async () => { joins += 1; return { answer: "answer" }; },
    });
    await assert.rejects(calls.joinMedia(CALL_ID, { session: { sdp: "offer" } }, local, {
      db, joinAgent: async () => { joins += 1; },
    }), (error) => error.publicCode === "CALL_SESSION_CONFLICT");
    await assert.rejects(calls.terminate(CALL_ID, { agent: local }, {
      db, terminateCall: async () => { terminations += 1; },
    }), (error) => error.publicCode === "CALL_SESSION_CONFLICT");
    await assert.rejects(calls.mediaReady(CALL_ID, {}, local, {
      db, mediaGateway: { waitForAgentReady: async () => { throw new Error("não deve tocar na mídia"); } },
    }), (error) => error.publicCode === "CALL_SESSION_CONFLICT");
    assert.equal(joins, 1);
    assert.equal(terminations, 0);
    assert.equal(sessions.get(CALL_ID).clientId, production.clientId);
  } finally {
    sessions.remove(CALL_ID);
    if (original === undefined) delete process.env.CALL_MEDIA_GATEWAY_ENABLED;
    else process.env.CALL_MEDIA_GATEWAY_ENABLED = original;
  }
});

test("abas distintas no mesmo ambiente também não substituem a mídia", () => {
  sessions.remove(CALL_ID);
  sessions.claim(CALL_ID, production);
  assert.throws(() => sessions.claim(CALL_ID, { ...production, clientId: "other-tab" }),
    (error) => error.publicCode === "CALL_SESSION_CONFLICT");
  sessions.remove(CALL_ID);
});

test("sessões outbound independentes não se confundem e preservam posse ao vincular", () => {
  sessions.claim("media-prod", production);
  sessions.claim("media-local", local);
  assert.throws(() => sessions.assertOwner("media-prod", local), /outra sessão/);
  sessions.move("media-prod", CALL_ID);
  assert.equal(sessions.get(CALL_ID).environment, "production");
  assert.equal(sessions.get("media-local").environment, "local");
  sessions.remove(CALL_ID);
  sessions.remove("media-local");
});

test("limites de chamada separam ambientes mesmo quando compartilham IP e atendente", () => {
  const { callRateLimitKey } = require("../src/middleware/rateLimiter");
  assert.notEqual(callRateLimitKey({ ip: "127.0.0.1", agent: local }),
    callRateLimitKey({ ip: "127.0.0.1", agent: production }));
  assert.equal(callRateLimitKey({ ip: "127.0.0.1", agent: production }),
    callRateLimitKey({ ip: "10.0.0.1", agent: { ...production, clientId: "other-tab" } }));
});

test("desconectar teste mantém o atendente conectado em produção", () => {
  const presence = require("../src/services/callPresence.service");
  presence.reset();
  presence.connect(local, "local-socket");
  presence.connect(production, "production-socket");
  presence.disconnect(local.id, "local-socket");
  assert.equal(presence.get(production.id).online, true);
  assert.deepEqual(presence.environments(production.id), ["production"]);
  presence.reset();
});
