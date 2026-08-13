const { rateLimit } = require("express-rate-limit");

const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Limite temporário de envios excedido." },
});

module.exports = { messageSendLimiter };
