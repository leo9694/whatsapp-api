const express = require("express");
const controller = require("../controllers/whatsappChannel.controller");

const router = express.Router();
router.get("/api/whatsapp/channels", controller.list);

module.exports = router;
