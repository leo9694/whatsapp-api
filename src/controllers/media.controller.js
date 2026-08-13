const multer = require("multer");
const AppError = require("../utils/AppError");
const conversationService = require("../services/conversation.service");
const mediaService = require("../services/media.service");
const whatsappService = require("../services/whatsapp.service");
const { idSchema } = require("../validators/conversation.validator");
const { success } = require("../utils/apiResponse");

function parseVoice(value) {
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError("O campo voice deve ser true ou false.", 400);
}

function sendUploaded(kind) {
  return async (req, res, next) => {
    try {
      const options = {
        caption: typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 1024) : undefined,
        filename: typeof req.body?.filename === "string" ? mediaService.safeFilename(req.body.filename) : undefined,
        voice: parseVoice(req.body?.voice),
      };
      const message = await conversationService.sendMedia(idSchema.parse(req.params.id), kind, req.file, options);
      return success(res, message, 201);
    } catch (error) { return next(error); }
    finally { await mediaService.cleanupUpload(req.file); }
  };
}

async function proxyMedia(req, res, next) {
  try {
    const mediaId = String(req.params.mediaId || "");
    if (!/^[A-Za-z0-9._:-]{3,512}$/.test(mediaId)) throw new AppError("Media ID inválido.", 400);
    const { stream, headers, metadata } = await whatsappService.downloadMedia(mediaId);
    const contentType = headers["content-type"] || metadata.mime_type || "application/octet-stream";
    res.status(200).type(contentType);
    if (headers["content-length"]) res.set("Content-Length", headers["content-length"]);
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", "inline");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (error) { return next(error); }
}

function normalizeUploadError(error, _req, _res, next) {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return next(new AppError(error.code === "LIMIT_FILE_SIZE" ? "Arquivo excede o limite máximo." : "Upload inválido.", status));
  }
  return next(error);
}

module.exports = {
  proxyMedia,
  sendImage: sendUploaded("image"),
  sendDocument: sendUploaded("document"),
  sendVideo: sendUploaded("video"),
  sendAudio: sendUploaded("audio"),
  normalizeUploadError,
};
