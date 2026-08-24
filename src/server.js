require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const whatsappRoutes = require("./routes/whatsapp.routes");
const legalRoutes = require("./routes/legal.routes");
const conversationRoutes = require("./routes/conversation.routes");
const messageRoutes = require("./routes/message.routes");
const statusRoutes = require("./routes/status.routes");
const templateRoutes = require("./routes/template.routes");
const mediaRoutes = require("./routes/media.routes");
const callRoutes = require("./routes/call.routes");
const logger = require("./utils/logger");
const webhookRequestLogger = require("./middleware/webhookRequestLogger");
const authenticateRequest = require("./middleware/authenticateRequest");
const errorHandler = require("./middleware/errorHandler");
const { createCorsOptions } = require("./config/frontendOrigins");
const { initializeSocket } = require("./sockets/socket");
const prisma = require("./database/prisma");

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST?.trim() || "127.0.0.1";

app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(helmet());
app.use(cors(createCorsOptions()));
app.use("/webhook/whatsapp", webhookRequestLogger);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
app.use(legalRoutes);
app.use(whatsappRoutes);
app.use("/api", authenticateRequest);
app.use(conversationRoutes);
app.use(messageRoutes);
app.use(statusRoutes);
app.use(templateRoutes);
app.use(mediaRoutes);
app.use(callRoutes);

app.use(errorHandler);

function startServer() {
  const server = http.createServer(app);
  initializeSocket(server);
  server.listen(port, host, () => {
    logger.info("server_started", { host, port });
  });
  return server;
}

async function shutdown(signal, server) {
  logger.info("server_stopping", { signal });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

if (require.main === module) {
  const server = startServer();
  process.on("SIGTERM", () => shutdown("SIGTERM", server));
  process.on("SIGINT", () => shutdown("SIGINT", server));
}

module.exports = app;
module.exports.startServer = startServer;
