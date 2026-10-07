const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function callRateLimitKey(req) {
  return req.agent
    ? `call:${req.agent.environment || "production"}:${req.agent.id}`
    : ipKeyGenerator(req.ip);
}

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

const callActionLimiter = rateLimit({
  keyGenerator: callRateLimitKey,
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Limite temporário de ações de chamada excedido." } },
});

const callQueryLimiter = rateLimit({
  keyGenerator: callRateLimitKey,
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Limite temporário de consultas de chamada excedido." } },
});

module.exports = { messageSendLimiter, mediaDownloadLimiter, callActionLimiter, callQueryLimiter, callRateLimitKey };
