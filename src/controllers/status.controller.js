const prisma = require("../database/prisma");
const socket = require("../sockets/socket");

async function getStatus(_req, res) {
  let connected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    connected = true;
  } catch {
    connected = false;
  }

  return res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "degraded",
    whatsapp: {
      configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    },
    calling: {
      configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "v25.0",
      transport: "WEBRTC",
    },
    database: { connected },
    socket: { enabled: socket.isSocketEnabled() },
  });
}

module.exports = { getStatus };
