const prisma = require("../database/prisma");

function include() {
  return { call: { include: { contact: true, channel: true, conversation: { include: { channel: true } } } } };
}

function findById(id, db = prisma) {
  return db.callTransfer.findUnique({ where: { id }, include: include() });
}

function findOpenByCallId(callId, db = prisma) {
  return db.callTransfer.findFirst({
    where: { callId, status: { in: ["PENDING", "ACCEPTED"] } },
    include: include(),
  });
}

function create(data, db = prisma) {
  return db.callTransfer.create({ data, include: include() });
}

function transition(id, fromStatuses, data, db = prisma) {
  return db.callTransfer.updateMany({ where: { id, status: { in: fromStatuses } }, data });
}

function listExpired(now = new Date(), db = prisma) {
  return db.callTransfer.findMany({
    where: { status: { in: ["PENDING", "ACCEPTED"] }, expiresAt: { lte: now } },
    include: include(),
  });
}

function listOpenByCallId(callId, db = prisma) {
  return db.callTransfer.findMany({
    where: { callId, status: { in: ["PENDING", "ACCEPTED"] } },
    include: include(),
  });
}

module.exports = { create, findById, findOpenByCallId, listExpired, listOpenByCallId, transition };
