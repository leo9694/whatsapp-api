const express = require("express");
const controller = require("../controllers/conversation.controller");
const { messageSendLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
router.get("/api/conversations", controller.list);
router.post("/api/conversations", controller.create);
router.get("/api/conversations/:id", controller.get);
router.get("/api/conversations/:id/messages", controller.messages);
router.post("/api/conversations/:id/messages", messageSendLimiter, controller.sendMessage);
router.post("/api/conversations/:id/read", controller.read);
router.patch("/api/conversations/:id/status", controller.changeStatus);

module.exports = router;
