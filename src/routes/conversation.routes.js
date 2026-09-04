const express = require("express");
const controller = require("../controllers/conversation.controller");
const { messageSendLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
router.get("/api/conversations", controller.list);
router.post("/api/conversations", controller.create);
router.get("/api/conversations/:id", controller.get);
router.get("/api/conversations/:id/messages", controller.messages);
router.post("/api/conversations/:id/messages", messageSendLimiter, controller.sendMessage);
router.post("/api/conversations/:id/messages/reaction", messageSendLimiter, controller.sendReaction);
router.post("/api/conversations/:id/read", controller.read);
router.post("/api/conversations/:id/typing", messageSendLimiter, controller.typing);
router.post("/api/conversations/:id/assignment", controller.assignment);
router.patch("/api/conversations/:id/status", controller.changeStatus);
router.delete("/api/conversations/:id", controller.remove);

module.exports = router;
