const express = require("express");
const controller = require("../controllers/call.controller");
const { callActionLimiter, callQueryLimiter } = require("../middleware/rateLimiter");
const { requireAgent, requireConfiguredAgent } = require("../middleware/authenticateAgent");

const router = express.Router();

router.get("/api/calls", callQueryLimiter, controller.list);
router.get("/api/call-agents", requireAgent, callQueryLimiter, controller.agents);
router.post("/api/calls/:callId/media", requireAgent, callActionLimiter, controller.joinMedia);
router.post("/api/calls/:callId/media-ready", requireAgent, callActionLimiter, controller.mediaReady);
router.post("/api/calls/:callId/transfer", requireAgent, callActionLimiter, controller.requestTransfer);
router.post("/api/calls/:callId/transfer/:transferId/accept", requireAgent, callActionLimiter, controller.acceptTransfer);
router.post("/api/calls/:callId/transfer/:transferId/reject", requireAgent, callActionLimiter, controller.rejectTransfer);
router.post("/api/calls/:callId/transfer/:transferId/cancel", requireAgent, callActionLimiter, controller.cancelTransfer);
router.post("/api/calls/:callId/pre-accept", requireConfiguredAgent, callActionLimiter, controller.preAccept);
router.post("/api/calls/:callId/accept", requireConfiguredAgent, callActionLimiter, controller.accept);
router.post("/api/calls/:callId/reject", requireConfiguredAgent, callActionLimiter, controller.reject);
router.post("/api/calls/:callId/terminate", requireConfiguredAgent, callActionLimiter, controller.terminate);
router.get("/api/conversations/:id/calls", callQueryLimiter, controller.listConversation);
router.get("/api/conversations/:id/calls/permission", requireConfiguredAgent, callQueryLimiter, controller.permission);
router.post("/api/conversations/:id/calls/permission", requireConfiguredAgent, callActionLimiter, controller.requestPermission);
router.post("/api/conversations/:id/calls/media", requireAgent, callActionLimiter, controller.createOutboundMedia);
router.post("/api/conversations/:id/calls", requireConfiguredAgent, callActionLimiter, controller.initiate);

module.exports = router;
