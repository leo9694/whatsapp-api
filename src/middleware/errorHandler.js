const { ZodError } = require("zod");
const logger = require("../utils/logger");

function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Dados inválidos.",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  logger.error("request_failed", {
    message: error.message,
    status: error.status || 500,
  });

  const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 500;
  const response = { error: status >= 500 ? "Erro interno do servidor." : error.message };
  if (process.env.NODE_ENV !== "production" && error.details) response.details = error.details;
  return res.status(status).json(response);
}

module.exports = errorHandler;
