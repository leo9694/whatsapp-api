const prisma = require("../database/prisma");

function upsertByWaId({ waId, phone, profileName, name }, db = prisma) {
  const update = {};
  if (phone) update.phone = phone;
  if (profileName) {
    update.profileName = profileName;
    update.name = name || profileName;
  } else if (name) update.name = name;

  return db.contact.upsert({
    where: { waId },
    create: { waId, phone: phone || waId, profileName: profileName || null, name: name || profileName || null },
    update,
  });
}

function findByWaId(waId, db = prisma) {
  if (!waId) return Promise.resolve(null);
  return db.contact.findUnique({ where: { waId } });
}

module.exports = { upsertByWaId, findByWaId };
