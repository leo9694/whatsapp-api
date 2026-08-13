const { Server } = require("socket.io");
const { createCorsOptions } = require("../config/frontendOrigins");
const logger = require("../utils/logger");
const { isValidApiKey } = require("../middleware/authenticateRequest");

let io;

function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: createCorsOptions(),
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const apiKey = socket.handshake.auth?.apiKey || socket.handshake.headers["x-api-key"] || "";
    if (!isValidApiKey(apiKey)) return next(new Error("Não autorizado."));
    return next();
  });

  io.on("connection", (socket) => {
    logger.info("socket_connected", { socketId: socket.id });
    socket.on("disconnect", (reason) => logger.info("socket_disconnected", { socketId: socket.id, reason }));
  });
  return io;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

function isSocketEnabled() {
  return Boolean(io);
}

module.exports = { initializeSocket, emit, isSocketEnabled };
