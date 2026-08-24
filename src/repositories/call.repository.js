const prisma = require("../database/prisma");

function findByMetaCallId(metaCallId, db = prisma) {
  return db.call.findUnique({ where: { metaCallId }, include: { contact: true, conversation: true } });
}

function create(data, db = prisma) {
  return db.call.create({ data, include: { contact: true, conversation: true } });
}

function update(metaCallId, data, db = prisma) {
  return db.call.update({ where: { metaCallId }, data, include: { contact: true, conversation: true } });
}

function list({ where, skip, take }, db = prisma) {
  return Promise.all([
    db.call.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { contact: true },
    }),
    db.call.count({ where }),
  ]);
}

module.exports = { findByMetaCallId, create, update, list };
