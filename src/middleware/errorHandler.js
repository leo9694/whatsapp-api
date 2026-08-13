const { ZodError } = require("zod");
const logger = require("../utils/logger");

function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
  }

  const metaError = error.metaResponse?.error || {};
  logger.error("request_failed", {
    message: error.message,
    status: error.status || 500,
    ...(error.metaResponse ? {
      meta: {
        httpStatus: error.metaHttpStatus || null,
        code: metaError.code || null,
        errorSubcode: metaError.error_subcode || null,
        type: metaError.type || null,
        message: metaError.message || null,
        fbtraceId: metaError.fbtrace_id || null,
      },
    } : {}),
  });

  const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 500;
  const response = {
    success: false,
    error: {
      code: error.name === "MetaApiError" ? "META_API_ERROR" : status === 404 ? "NOT_FOUND" : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
      message: status >= 500 ? "Não foi possível concluir a solicitação." : error.message,
    },
  };
  if (process.env.NODE_ENV !== "production" && error.details) response.error.details = error.details;
  return res.status(status).json(response);
}

module.exports = errorHandler;
