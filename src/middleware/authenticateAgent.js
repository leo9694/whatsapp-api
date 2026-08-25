const AppError = require("../utils/AppError");
const { verifyAgentToken } = require("../utils/agentToken");

function authenticateAgent(req, _res, next) {
  try {
    const token = req.get("X-Agent-Token");
    if (token) req.agent = verifyAgentToken(token);
    return next();
  } catch (error) { return next(error); }
}

function requireAgent(req, _res, next) {
  if (!req.agent) return next(new AppError("Sessão autenticada do atendente obrigatória.", 401));
  return next();
}

function requireConfiguredAgent(req, res, next) {
  if (process.env.CALL_AGENT_AUTH_REQUIRED === "true") return requireAgent(req, res, next);
  return next();
}

module.exports = { authenticateAgent, requireAgent, requireConfiguredAgent };
