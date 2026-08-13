const express = require("express");
const controller = require("../controllers/message.controller");
const { messageSendLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
router.post("/api/messages/text", messageSendLimiter, controller.sendTextMessage);

module.exports = router;
