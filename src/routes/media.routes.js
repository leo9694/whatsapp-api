const express = require("express");
const controller = require("../controllers/media.controller");
const { uploadSingleMedia } = require("../middleware/upload");
const { messageSendLimiter, mediaDownloadLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
router.get("/api/media/:mediaId", mediaDownloadLimiter, controller.proxyMedia);
for (const [kind, handler] of [
  ["image", controller.sendImage], ["document", controller.sendDocument],
  ["video", controller.sendVideo], ["audio", controller.sendAudio],
]) {
  router.post(`/api/conversations/:id/messages/${kind}`, messageSendLimiter, uploadSingleMedia, controller.normalizeUploadError, handler);
}
module.exports = router;
