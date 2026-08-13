const crypto = require("crypto");

function digest(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function isValidApiKey(providedKey) {
  const configuredKey = process.env.INTERNAL_API_KEY?.trim();
  if (!configuredKey) return true;
  return crypto.timingSafeEqual(digest(configuredKey), digest(providedKey || ""));
}

function authenticateRequest(req, res, next) {
  const providedKey = req.get("X-API-Key") || "";
  if (!isValidApiKey(providedKey)) return res.status(401).json({ error: "Não autorizado." });
  return next();
}

module.exports = authenticateRequest;
module.exports.isValidApiKey = isValidApiKey;
