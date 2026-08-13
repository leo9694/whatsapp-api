const logger = require("../utils/logger");

function webhookRequestLogger(req, _res, next) {
  if (req.method === "POST") {
    logger.info("raw_webhook_request", {
      method: req.method,
      path: req.originalUrl?.split("?", 1)[0] || req.path,
      contentType: req.get("content-type") || null,
      userAgent: req.get("user-agent") || null,
      contentLength: req.get("content-length") || null,
    });
  }

  next();
}

module.exports = webhookRequestLogger;
