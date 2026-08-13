const fs = require("fs/promises");
const path = require("path");
const AppError = require("../utils/AppError");
const { MEDIA_RULES } = require("../config/media");
const whatsappService = require("./whatsapp.service");

function safeFilename(value = "file") {
  return path.basename(value).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file";
}

async function sniffMime(filePath, declaredMime) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
    if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
    if (bytes.subarray(0, 4).toString() === "OggS") return "audio/ogg";
    if (bytes.subarray(0, 6).toString() === "#!AMR\n") return "audio/amr";
    if (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return declaredMime === "audio/aac" ? "audio/aac" : "audio/mpeg";
    if (bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp") {
      return declaredMime?.startsWith("audio/") ? "audio/mp4" : declaredMime === "video/3gpp" ? "video/3gpp" : "video/mp4";
    }
    if (bytes.subarray(0, 4).equals(Buffer.from([0xd0,0xcf,0x11,0xe0]))) return declaredMime;
    if (bytes.subarray(0, 4).toString() === "PK\x03\x04") return declaredMime;
    if (!bytes.includes(0) && declaredMime === "text/plain") return "text/plain";
    return null;
  } finally { await handle.close(); }
}

async function validateUpload(file, kind) {
  if (!file || !file.path || file.size <= 0) throw new AppError("Envie um arquivo não vazio no campo 'file'.", 400);
  const rule = MEDIA_RULES[kind];
  if (!rule) throw new AppError("Tipo de mídia não suportado.", 400);
  if (file.size > rule.maxBytes) throw new AppError(`Arquivo excede o limite de ${Math.floor(rule.maxBytes / 1024 / 1024)} MB.`, 413);
  if (!rule.mimeTypes.includes(file.mimetype)) throw new AppError("MIME type não suportado para este tipo de mídia.", 415);
  const detected = await sniffMime(file.path, file.mimetype);
  if (!detected || detected !== file.mimetype) throw new AppError("O conteúdo do arquivo não corresponde ao MIME type informado.", 415);
  return { mimeType: detected, filename: safeFilename(file.originalname), size: file.size };
}

async function cleanupUpload(file) {
  if (!file?.path) return;
  await fs.unlink(file.path).catch(() => {});
}

async function upload(file, kind, dependencies = {}) {
  const uploadMedia = dependencies.uploadMedia || whatsappService.uploadMedia;
  const metadata = await validateUpload(file, kind);
  const result = await uploadMedia({ filePath: file.path, mimeType: metadata.mimeType, filename: metadata.filename });
  if (!result?.id) throw new AppError("A Meta não retornou o ID da mídia.", 502);
  return { mediaId: result.id, ...metadata };
}

module.exports = { safeFilename, sniffMime, validateUpload, cleanupUpload, upload };
