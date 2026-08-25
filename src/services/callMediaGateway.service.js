const crypto = require("crypto");
const AppError = require("../utils/AppError");

function enabled() {
  return process.env.CALL_MEDIA_GATEWAY_ENABLED === "true";
}

function configuration() {
  const url = String(process.env.MEDIA_GATEWAY_URL || "http://127.0.0.1:3025").replace(/\/+$/, "");
  const token = String(process.env.MEDIA_GATEWAY_TOKEN || "").trim();
  if (!token) throw new AppError("Gateway de mídia não configurado.", 503);
  return { url, token };
}

async function request(path, options = {}) {
  const { url, token } = configuration();
  const response = await fetch(`${url}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  }).catch((error) => { throw new AppError(`Gateway de mídia indisponível: ${error.message}`, 503); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError("O gateway de mídia recusou a operação.", response.status >= 500 ? 503 : 409);
  return data;
}

function json(method, value) {
  return { method, body: JSON.stringify(value) };
}

function prepareInbound(callId, offer) {
  return request("/v1/calls/inbound", json("POST", { callId, offer }));
}

async function createOutboundSession() {
  const sessionId = crypto.randomUUID();
  await request("/v1/sessions", json("POST", { sessionId }));
  return sessionId;
}

function createMetaOffer(sessionId) {
  return request(`/v1/sessions/${encodeURIComponent(sessionId)}/meta-offer`, { method: "POST" });
}

function bindOutboundSession(sessionId, callId) {
  return request(`/v1/sessions/${encodeURIComponent(sessionId)}/bind`, json("POST", { callId }));
}

function setMetaAnswer(callId, answer) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/meta-answer`, json("POST", { answer }));
}

function getMetaSession(callId) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/meta-session`);
}

function joinAgent(callId, agent, offer) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/agents`, json("POST", {
    agentId: agent.id, agentName: agent.name, offer,
  }));
}

function agentReady(callId, agentId) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/agents/${encodeURIComponent(agentId)}/ready`);
}

function setCurrentAgent(callId, agentId) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/current-agent`, json("POST", { agentId }));
}

function removeAgent(callId, agentId) {
  return request(`/v1/calls/${encodeURIComponent(callId)}/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
}

function closeCall(callId) {
  return request(`/v1/calls/${encodeURIComponent(callId)}`, { method: "DELETE" });
}

module.exports = {
  agentReady, bindOutboundSession, closeCall, createMetaOffer, createOutboundSession,
  enabled, getMetaSession, joinAgent, prepareInbound, removeAgent, setCurrentAgent, setMetaAnswer,
};
