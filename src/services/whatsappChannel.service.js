const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const repository = require("../repositories/whatsappChannel.repository");
const { toChannelDto } = require("../utils/channelDto");
const whatsappService = require("./whatsapp.service");

const PROFILE_PICTURE_TTL_MS = 60 * 60 * 1000;
const profilePictures = new Map();

async function getProfilePicture(channel, service = whatsappService, cache = profilePictures) {
  const key = String(channel?.phoneNumberId || "");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.updatedAt < PROFILE_PICTURE_TTL_MS) return cached.url;
  try {
    const url = await service.getBusinessProfilePicture(key);
    cache.set(key, { url: url || null, updatedAt: Date.now() });
    return url || null;
  } catch {
    // A listagem dos canais deve continuar disponível se a Meta não retornar a foto.
    cache.set(key, { url: null, updatedAt: Date.now() });
    return null;
  }
}

async function listChannels(db = prisma, options = {}) {
  const channels = await repository.listActive(db);
  const service = options.whatsappService || whatsappService;
  const cache = options.profilePictureCache || profilePictures;
  return {
    data: await Promise.all(channels.map(async (channel) => toChannelDto({
      ...channel,
      profilePictureUrl: await getProfilePicture(channel, service, cache),
    }))),
  };
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
