const prisma = require("../database/prisma");

function findByMetaCallId(metaCallId, db = prisma) {
  return db.call.findUnique({
    where: { metaCallId },
    include: { contact: true, channel: true, conversation: { include: { channel: true } }, transfers: { orderBy: { requestedAt: "asc" } } },
  });
}

function create(data, db = prisma) {
  return db.call.create({ data, include: { contact: true, channel: true, conversation: { include: { channel: true } }, transfers: true } });
}

function update(metaCallId, data, db = prisma) {
  return db.call.update({
    where: { metaCallId }, data,
    include: { contact: true, channel: true, conversation: { include: { channel: true } }, transfers: { orderBy: { requestedAt: "asc" } } },
  });
}

function list({ where, skip, take }, db = prisma) {
  return Promise.all([
    db.call.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { contact: true, channel: true, transfers: { orderBy: { requestedAt: "asc" } } },
    }),
    db.call.count({ where }),
  ]);
}

function findActiveByAgent(agentId, db = prisma) {
  return db.call.findFirst({ where: { currentAgentId: String(agentId), status: { in: ["RINGING", "CONNECTING", "ACTIVE"] } } });
}

async function updateUnclaimed(metaCallId, data, db = prisma) {
  const result = await db.call.updateMany({
    where: { metaCallId, currentAgentId: null, status: { in: ["RINGING", "CONNECTING", "ACTIVE"] } }, data,
  });
  return result.count ? findByMetaCallId(metaCallId, db) : null;
}

function findActiveByConversation(conversationId, db = prisma) {
  return db.call.findFirst({ where: { conversationId, status: { in: ["RINGING", "CONNECTING", "ACTIVE"] } } });
}

module.exports = { updateUnclaimed, findActiveByAgent, findActiveByConversation, findByMetaCallId, create, update, list };
