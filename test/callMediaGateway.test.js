const test = require("node:test");
const assert = require("node:assert/strict");
const gateway = require("../src/services/callMediaGateway.service");

test("aguarda o primeiro RTP em vez de falhar na primeira consulta", async () => {
  const responses = [
    { ready: false, lastRtpAgeMs: -1, iceState: "checking" },
    { ready: false, lastRtpAgeMs: -1, iceState: "connected" },
    { ready: true, lastRtpAgeMs: 12, iceState: "connected" },
  ];
  let checks = 0;
  const result = await gateway.waitForAgentReady("call", "agent", {
    timeoutMs: 1000,
    intervalMs: 1,
    check: async () => responses[Math.min(checks++, responses.length - 1)],
    sleep: async () => {},
  });
  assert.equal(result.ready, true);
  assert.equal(checks, 3);
});

test("encerra a espera quando o prazo de RTP termina", async () => {
  let now = 0;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const result = await gateway.waitForAgentReady("call", "agent", {
      timeoutMs: 500,
      intervalMs: 250,
      check: async () => ({ ready: false, lastRtpAgeMs: -1, iceState: "checking" }),
      sleep: async (milliseconds) => { now += milliseconds; },
    });
    assert.equal(result.ready, false);
    assert.equal(now, 500);
  } finally {
    Date.now = originalNow;
  }
});

test("exige estabilidade da perna Meta antes de liberar o áudio", async () => {
  const responses = [
    { ready: true, iceState: "connected", peerState: "connected" },
    { ready: false, iceState: "closed", peerState: "closed" },
    { ready: true, iceState: "connected", peerState: "connected" },
    { ready: true, iceState: "connected", peerState: "connected" },
    { ready: true, iceState: "connected", peerState: "connected" },
  ];
  let checks = 0;
  const result = await gateway.waitForMetaReady("call", {
    timeoutMs: 1000,
    intervalMs: 1,
    check: async () => responses[Math.min(checks++, responses.length - 1)],
    sleep: async () => {},
  });
  assert.equal(result.ready, true);
  assert.equal(checks, 5);
});
