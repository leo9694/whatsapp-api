require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const whatsappRoutes = require("./routes/whatsapp.routes");
const logger = require("./utils/logger");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
app.use(whatsappRoutes);

app.use((error, _req, res, _next) => {
  logger.error("request_failed", {
    message: error.message,
    status: error.status || 500,
  });

  const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 500;
  const response = { error: status >= 500 ? "Erro interno do servidor." : error.message };
  if (process.env.NODE_ENV !== "production" && error.metaResponse) {
    response.details = error.metaResponse;
  }
  res.status(status).json(response);
});

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    logger.info("server_started", { port });
  });
}

module.exports = app;
