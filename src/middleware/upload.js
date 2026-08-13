const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDirectory = path.join(__dirname, "../../storage/tmp");
fs.mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
try { fs.chmodSync(uploadDirectory, 0o700); } catch {}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, _file, callback) => callback(null, crypto.randomBytes(24).toString("hex")),
});

const uploadSingleMedia = multer({
  storage,
  limits: { files: 1, fileSize: 100 * 1024 * 1024, fields: 5, fieldSize: 16 * 1024 },
}).single("file");

module.exports = { uploadSingleMedia, uploadDirectory };
