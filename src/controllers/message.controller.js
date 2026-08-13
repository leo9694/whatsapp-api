const whatsappService = require("../services/whatsapp.service");
const { legacyTextMessageSchema } = require("../validators/message.validator");

async function sendTextMessage(req, res, next) {
  try {
    const { to, text } = legacyTextMessageSchema.parse(req.body);
    return res.status(200).json(await whatsappService.sendTextMessage(to, text));
  } catch (error) { return next(error); }
}

module.exports = { sendTextMessage };
