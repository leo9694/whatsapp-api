const AppError = require("../utils/AppError");
const { normalizeEnvironment } = require("../utils/agentToken");

const sessions = new Map();

function identity(agent = {}) {
  return {
    id: String(agent.id || ""),
    name: agent.name,
    environment: normalizeEnvironment(agent.environment),
    clientId: String(agent.clientId || `legacy:${agent.id}`),
  };
}

function assertOwner(key, agent) {
  const owner = sessions.get(key);
  const current = identity(agent);
  if (owner && (owner.id !== current.id || owner.environment !== current.environment || owner.clientId !== current.clientId)) {
    const error = new AppError("Chamada em atendimento em outra sessão ou ambiente.", 409);
    error.publicCode = "CALL_SESSION_CONFLICT";
    throw error;
  }
  return owner || null;
}

function claim(key, agent, ttlMs) {
  const existing = assertOwner(key, agent);
  if (existing) return existing;
  const owner = { ...identity(agent), claimedAt: new Date().toISOString() };
  sessions.set(key, owner);
  if (ttlMs) {
    const timer = setTimeout(() => { if (sessions.get(key) === owner) remove(key); }, ttlMs);
    timer.unref();
  }
  return owner;
}

function get(key) { return sessions.get(key) || null; }
function remove(key) {
  const removed = sessions.delete(key);
  for (const item of sessions.keys()) if (item.startsWith(`${key}:transfer:`)) sessions.delete(item);
  return removed;
}
function move(from, to) {
  const owner = get(from);
  if (owner) { sessions.set(to, owner); remove(from); }
}

module.exports = { assertOwner, claim, get, move, remove };
