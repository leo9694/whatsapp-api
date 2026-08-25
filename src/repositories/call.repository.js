const prisma = require("../database/prisma");

function findByMetaCallId(metaCallId, db = prisma) {
  return db.call.findUnique({
    where: { metaCallId },
    include: { contact: true, conversation: true, transfers: { orderBy: { requestedAt: "asc" } } },
  });
}

function create(data, db = prisma) {
  return db.call.create({ data, include: { contact: true, conversation: true, transfers: true } });
}

function update(metaCallId, data, db = prisma) {
  return db.call.update({
    where: { metaCallId }, data,
    include: { contact: true, conversation: true, transfers: { orderBy: { requestedAt: "asc" } } },
  });
}

function list({ where, skip, take }, db = prisma) {
  return Promise.all([
    db.call.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { contact: true, transfers: { orderBy: { requestedAt: "asc" } } },
    }),
    db.call.count({ where }),
  ]);
}

function findActiveByAgent(agentId, db = prisma) {
  return db.call.findFirst({ where: { currentAgentId: String(agentId), status: "ACTIVE" } });
}

module.exports = { findActiveByAgent, findByMetaCallId, create, update, list };
