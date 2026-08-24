const express = require("express");
const controller = require("../controllers/call.controller");
const { callActionLimiter, callQueryLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.get("/api/calls", callQueryLimiter, controller.list);
router.post("/api/calls/:callId/pre-accept", callActionLimiter, controller.preAccept);
router.post("/api/calls/:callId/accept", callActionLimiter, controller.accept);
router.post("/api/calls/:callId/reject", callActionLimiter, controller.reject);
router.post("/api/calls/:callId/terminate", callActionLimiter, controller.terminate);
router.get("/api/conversations/:id/calls", callQueryLimiter, controller.listConversation);
router.get("/api/conversations/:id/calls/permission", callQueryLimiter, controller.permission);
router.post("/api/conversations/:id/calls/permission", callActionLimiter, controller.requestPermission);
router.post("/api/conversations/:id/calls", callActionLimiter, controller.initiate);

module.exports = router;
