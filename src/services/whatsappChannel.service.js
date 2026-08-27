const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const repository = require("../repositories/whatsappChannel.repository");
const { toChannelDto } = require("../utils/channelDto");

async function listChannels(db = prisma) {
  return { data: (await repository.listActive(db)).map(toChannelDto) };
}

async function resolveSelection({ channelId, phoneNumberId } = {}, db = prisma) {
  let channel;
  if (channelId) channel = await repository.findById(channelId, db);
  else if (phoneNumberId) channel = await repository.findByPhoneNumberId(phoneNumberId, db);
  else channel = await repository.findDefault(db);
  if (!channel || !channel.isActive) throw new AppError("Canal do WhatsApp não encontrado ou inativo.", 404);
  if (channelId && phoneNumberId && channel.phoneNumberId !== String(phoneNumberId)) {
    throw new AppError("channelId e phoneNumberId identificam canais diferentes.", 400);
  }
  return channel;
}

function resolveInbound(phoneNumberId, db = prisma) {
  return repository.findByPhoneNumberId(phoneNumberId, db);
}

module.exports = { listChannels, resolveInbound, resolveSelection };
