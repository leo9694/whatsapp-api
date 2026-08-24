const crypto = require("crypto");

const TTL_MS = 5 * 60 * 1000;
const signals = new Map();

function cleanup(now = Date.now()) {
  for (const [callId, value] of signals) {
    if (value.expiresAt <= now) signals.delete(callId);
  }
}

function put(callId, patch) {
  cleanup();
  signals.set(callId, { ...(signals.get(callId) || {}), ...patch, expiresAt: Date.now() + TTL_MS });
}

function setRemoteSession(callId, session) {
  if (session?.sdp && session?.sdp_type) {
    put(callId, { remoteSession: { sdpType: session.sdp_type, sdp: session.sdp } });
  }
}

function setPreAcceptAnswer(callId, sdp) {
  put(callId, { preAcceptAnswerHash: crypto.createHash("sha256").update(sdp).digest("hex") });
}

function matchesPreAcceptAnswer(callId, sdp) {
  const expected = signals.get(callId)?.preAcceptAnswerHash;
  if (!expected) return true;
  return crypto.createHash("sha256").update(sdp).digest("hex") === expected;
}

function getRemoteSession(callId) {
  cleanup();
  return signals.get(callId)?.remoteSession || null;
}

function remove(callId) {
  signals.delete(callId);
}

module.exports = { setRemoteSession, setPreAcceptAnswer, matchesPreAcceptAnswer, getRemoteSession, remove };
