const prisma = require("../database/prisma");

function findByWamid(wamid, db = prisma) {
  if (!wamid) return Promise.resolve(null);
  return db.message.findUnique({ where: { wamid } });
}

function create(data, db = prisma) {
  return db.message.create({ data });
}

function findById(id, db = prisma) {
  return db.message.findUnique({ where: { id } });
}

function listByConversation({ conversationId, skip, take }, db = prisma) {
  const where = { conversationId };
  return Promise.all([
    db.message.findMany({
      where,
      skip,
      take,
      orderBy: [{ messageTimestamp: "desc" }, { createdAt: "desc" }],
    }),
    db.message.count({ where }),
  ]);
}

function updateStatusByWamid(wamid, status, failureDetails, db = prisma) {
  const data = { status };
  if (failureDetails !== undefined) data.failureDetails = failureDetails;
  return db.message.update({ where: { wamid }, data });
}

function findLatestInbound(conversationId, db = prisma) {
  return db.message.findFirst({
    where: { conversationId, direction: "INBOUND", wamid: { not: null } },
    orderBy: [{ messageTimestamp: "desc" }, { createdAt: "desc" }],
  });
}

module.exports = { findByWamid, create, findById, listByConversation, updateStatusByWamid, findLatestInbound };
