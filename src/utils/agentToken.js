const crypto = require("crypto");
const AppError = require("./AppError");

const ISSUER = "norte-sul-atendimento";
const AUDIENCE = "norte-sul-whatsapp-api";

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function normalizeEnvironment(value) {
  return String(value || "production").trim().toLowerCase()
    .replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "production";
}

function verifyAgentToken(token, secret = process.env.CALL_AGENT_AUTH_SECRET) {
  const configured = String(secret || "").trim();
  if (configured.length < 32) throw new AppError("Autenticação individual de chamadas não configurada.", 503);
  const [payloadPart, signaturePart, extra] = String(token || "").split(".");
  if (!payloadPart || !signaturePart || extra) throw new AppError("Token de atendente inválido.", 401);
  const expected = crypto.createHmac("sha256", configured).update(payloadPart).digest();
  let received;
  try { received = Buffer.from(signaturePart, "base64url"); }
  catch { throw new AppError("Token de atendente inválido.", 401); }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new AppError("Token de atendente inválido.", 401);
  }
  let payload;
  try { payload = decodePart(payloadPart); }
  catch { throw new AppError("Token de atendente inválido.", 401); }
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISSUER || payload.aud !== AUDIENCE || !payload.sub
    || !payload.name || !Number.isInteger(payload.exp) || payload.exp <= now
    || !Number.isInteger(payload.iat) || payload.iat > now + 30) {
    throw new AppError("Token de atendente expirado ou inválido.", 401);
  }
  return {
    id: String(payload.sub).slice(0, 64),
    name: String(payload.name).slice(0, 160),
    director: payload.director === true,
    environment: normalizeEnvironment(payload.environment),
  };
}

module.exports = { AUDIENCE, ISSUER, normalizeEnvironment, verifyAgentToken };
