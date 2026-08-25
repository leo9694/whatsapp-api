const agents = new Map();

function connect(agent, socketId) {
  const id = String(agent.id);
  const current = agents.get(id) || { id, name: agent.name, sockets: new Set(), calls: new Set() };
  current.name = agent.name;
  current.director = agent.director === true;
  current.sockets.add(socketId);
  current.lastSeenAt = new Date();
  agents.set(id, current);
}

function disconnect(agentId, socketId) {
  const current = agents.get(String(agentId));
  if (!current) return;
  current.sockets.delete(socketId);
  current.lastSeenAt = new Date();
}

function markBusy(agentId, callId) {
  const current = agents.get(String(agentId));
  if (current) current.calls.add(String(callId));
}

function clearBusy(agentId, callId) {
  const current = agents.get(String(agentId));
  if (current) current.calls.delete(String(callId));
}

function get(agentId) {
  const current = agents.get(String(agentId));
  if (!current) return null;
  const online = current.sockets.size > 0;
  const busy = current.calls.size > 0;
  return {
    id: current.id,
    name: current.name,
    online,
    activeCall: busy,
    availability: !online ? "OFFLINE" : busy ? "BUSY" : "AVAILABLE",
  };
}

function list() {
  return [...agents.keys()].map(get).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function availableIds() {
  return list().filter((agent) => agent.availability === "AVAILABLE").map((agent) => agent.id);
}

function reset() {
  agents.clear();
}

module.exports = { availableIds, clearBusy, connect, disconnect, get, list, markBusy, reset };
