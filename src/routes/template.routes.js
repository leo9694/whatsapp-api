const express = require("express");
const controller = require("../controllers/template.controller");
const { messageSendLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
router.get("/api/templates", controller.list);
router.get("/api/templates/:name", controller.get);
router.post("/api/templates/preview", controller.preview);
router.post("/api/conversations/:id/messages/template", messageSendLimiter, controller.send);
module.exports = router;
