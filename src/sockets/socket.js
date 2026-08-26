const { Server } = require("socket.io");
const { createCorsOptions } = require("../config/frontendOrigins");
const logger = require("../utils/logger");
const { isValidApiKey } = require("../middleware/authenticateRequest");
const { normalizeEnvironment, verifyAgentToken } = require("../utils/agentToken");
const presence = require("../services/callPresence.service");

let io;

function deliveryEnvironments() {
  const configured = String(process.env.CALL_DELIVERY_ENVS || process.env.CALL_DELIVERY_ENV || "production")
    .split(",")
    .map((value) => normalizeEnvironment(value))
    .filter(Boolean);
  return [...new Set(configured.length ? configured : ["production"])];
}

function agentRoom(agentId, environment = deliveryEnvironments()[0]) {
  return `agent:${String(agentId)}:${normalizeEnvironment(environment)}`;
}

function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: createCorsOptions(),
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const apiKey = socket.handshake.auth?.apiKey || socket.handshake.headers["x-api-key"] || "";
    if (!isValidApiKey(apiKey)) return next(new Error("Não autorizado."));
    const agentToken = socket.handshake.auth?.agentToken || "";
    if (agentToken) {
      try { socket.data.agent = verifyAgentToken(agentToken); }
      catch { return next(new Error("Atendente não autorizado.")); }
    }
    return next();
  });

  io.on("connection", (socket) => {
    if (socket.data.agent) {
      socket.join(agentRoom(socket.data.agent.id, socket.data.agent.environment));
      presence.connect(socket.data.agent, socket.id);
    }
    logger.info("socket_connected", { socketId: socket.id });
    socket.on("disconnect", (reason) => {
      if (socket.data.agent) presence.disconnect(socket.data.agent.id, socket.id);
      logger.info("socket_disconnected", { socketId: socket.id, reason });
    });
  });
  return io;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

function emitToAgent(agentId, event, payload) {
  if (!io || !agentId) return;
  deliveryEnvironments().forEach((environment) => {
    io.to(agentRoom(agentId, environment)).emit(event, payload);
  });
}

function emitToAgents(agentIds, event, payload) {
  [...new Set((agentIds || []).map(String))].forEach((agentId) => emitToAgent(agentId, event, payload));
}

function joinAgentCall(agentId, callId) {
  if (!io || !agentId || !callId) return;
  deliveryEnvironments().forEach((environment) => {
    io.in(agentRoom(agentId, environment)).socketsJoin(`call:${String(callId)}`);
  });
}

function leaveAgentCall(agentId, callId) {
  if (!io || !agentId || !callId) return;
  deliveryEnvironments().forEach((environment) => {
    io.in(agentRoom(agentId, environment)).socketsLeave(`call:${String(callId)}`);
  });
}

function closeCallRoom(callId) {
  if (io && callId) io.in(`call:${String(callId)}`).socketsLeave(`call:${String(callId)}`);
}

function isSocketEnabled() {
  return Boolean(io);
}

module.exports = {
  agentRoom, deliveryEnvironments,
  closeCallRoom, emit, emitToAgent, emitToAgents, initializeSocket,
  isSocketEnabled, joinAgentCall, leaveAgentCall,
};
