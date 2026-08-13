const { rateLimit } = require("express-rate-limit");

const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Limite temporário de envios excedido." },
});

const mediaDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Limite temporário de downloads excedido." } },
});

module.exports = { messageSendLimiter, mediaDownloadLimiter };
