const service = require("../services/whatsappChannel.service");

async function list(_req, res, next) {
  try { return res.json(await service.listChannels()); }
  catch (error) { return next(error); }
}

module.exports = { list };
