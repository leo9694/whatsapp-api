const prisma = require("../database/prisma");

function findById(id, db = prisma) {
  return db.whatsAppChannel.findUnique({ where: { id } });
}

function findByPhoneNumberId(phoneNumberId, db = prisma) {
  if (!phoneNumberId) return Promise.resolve(null);
  return db.whatsAppChannel.findUnique({ where: { phoneNumberId: String(phoneNumberId) } });
}

function findDefault(db = prisma) {
  return db.whatsAppChannel.findFirst({ where: { isDefault: true, isActive: true } });
}

function listActive(db = prisma) {
  return db.whatsAppChannel.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
}

module.exports = { findById, findByPhoneNumberId, findDefault, listActive };
