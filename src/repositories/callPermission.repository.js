const prisma = require("../database/prisma");

function find(conversationId, phoneNumberId, db = prisma) {
  return db.callPermission.findUnique({
    where: { conversationId_phoneNumberId: { conversationId, phoneNumberId } },
  });
}

function findByWebhookWamid(lastWebhookWamid, db = prisma) {
  if (!lastWebhookWamid) return null;
  return db.callPermission.findUnique({ where: { lastWebhookWamid } });
}

function upsert(conversationId, phoneNumberId, data, db = prisma) {
  return db.callPermission.upsert({
    where: { conversationId_phoneNumberId: { conversationId, phoneNumberId } },
    create: { conversationId, phoneNumberId, ...data },
    update: data,
  });
}

function update(id, data, db = prisma) {
  return db.callPermission.update({ where: { id }, data });
}

module.exports = { find, findByWebhookWamid, update, upsert };
