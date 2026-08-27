const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const AppError = require("../utils/AppError");
const { MEDIA_RULES } = require("../config/media");
const whatsappService = require("./whatsapp.service");
const execFileAsync = promisify(execFile);

function normalizeMime(value = "") {
  return value.split(";", 1)[0].trim().toLowerCase();
}

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
    if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "audio/webm";
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
  const declaredMime = normalizeMime(file.mimetype);
  const genericAudio = kind === "audio" && (!declaredMime || declaredMime === "application/octet-stream");
  const detected = await sniffMime(file.path, genericAudio ? "audio/webm" : declaredMime);
  if (genericAudio) {
    if (!detected || !rule.mimeTypes.includes(detected)) throw new AppError("O arquivo enviado não contém áudio suportado.", 415);
    return { mimeType: detected, filename: safeFilename(file.originalname), size: file.size };
  }
  if (!rule.mimeTypes.includes(declaredMime)) throw new AppError("MIME type não suportado para este tipo de mídia.", 415);
  if (!detected || detected !== declaredMime) throw new AppError("O conteúdo do arquivo não corresponde ao MIME type informado.", 415);
  return { mimeType: detected, filename: safeFilename(file.originalname), size: file.size };
}

async function transcodeWebmToOgg(file) {
  if (!ffmpegPath) throw new AppError("Conversão de áudio indisponível no servidor.", 503);
  const outputPath = path.join(path.dirname(file.path), `${crypto.randomBytes(24).toString("hex")}.ogg`);
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", file.path, "-map_metadata", "-1", "-vn", "-t", "600",
      "-c:a", "libopus", "-ac", "1", "-ar", "48000",
      "-b:a", "32k", "-vbr", "on", "-application", "voip",
      "-threads", "1", outputPath,
    ], { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    const stat = await fs.stat(outputPath);
    if (!stat.size || stat.size > MEDIA_RULES.audio.maxBytes || await sniffMime(outputPath, "audio/ogg") !== "audio/ogg") {
      throw new Error("invalid transcoded output");
    }
    return {
      path: outputPath,
      size: stat.size,
      mimetype: "audio/ogg",
      originalname: `${path.parse(safeFilename(file.originalname)).name || "audio"}.ogg`,
    };
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("Não foi possível converter o áudio WebM para OGG/Opus.", 422);
  }
}

async function cleanupUpload(file) {
  if (!file?.path) return;
  await fs.unlink(file.path).catch(() => {});
}

async function upload(file, kind, dependencies = {}) {
  const uploadMedia = dependencies.uploadMedia || whatsappService.uploadMedia;
  const transcodeAudio = dependencies.transcodeAudio || transcodeWebmToOgg;
  let preparedFile = file;
  let temporaryConversion;
  try {
    let metadata = await validateUpload(file, kind);
    if (kind === "audio" && metadata.mimeType === "audio/webm") {
      preparedFile = await transcodeAudio(file);
      temporaryConversion = preparedFile;
      metadata = await validateUpload(preparedFile, kind);
    }
    const uploadMimeType = kind === "audio" && metadata.mimeType === "audio/ogg"
      ? "audio/ogg; codecs=opus"
      : metadata.mimeType;
    const result = await uploadMedia({ filePath: preparedFile.path, mimeType: uploadMimeType, filename: metadata.filename });
    if (!result?.id) throw new AppError("A Meta não retornou o ID da mídia.", 502);
    return { mediaId: result.id, ...metadata, mimeType: uploadMimeType };
  } finally {
    await cleanupUpload(temporaryConversion);
  }
}

module.exports = { safeFilename, sniffMime, validateUpload, cleanupUpload, transcodeWebmToOgg, upload };
