const express = require("express");
const whatsappController = require("../controllers/whatsapp.controller");

const router = express.Router();

router.get("/webhook/whatsapp", whatsappController.verifyWebhook);
router.post("/webhook/whatsapp", whatsappController.receiveWebhook);
router.post("/api/messages/text", whatsappController.sendTextMessage);

module.exports = router;
