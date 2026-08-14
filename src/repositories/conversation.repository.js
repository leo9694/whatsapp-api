const prisma = require("../database/prisma");

function findOpenByContactId(contactId, db = prisma) {
  return db.conversation.findFirst({ where: { contactId, status: "OPEN" }, orderBy: { createdAt: "desc" } });
}

function createForContact(contactId, db = prisma) {
  return db.conversation.create({ data: { contactId, status: "OPEN" } });
}

function findById(id, db = prisma) {
  return db.conversation.findUnique({ where: { id }, include: { contact: true } });
}

function list({ skip, take, search, status }, db = prisma) {
  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          contact: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { profileName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { waId: { contains: search } },
            ],
          },
        }
      : {}),
  };

  return Promise.all([
    db.conversation.findMany({
      where,
      skip,
      take,
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      include: {
        contact: true,
        messages: { take: 1, orderBy: [{ messageTimestamp: "desc" }, { createdAt: "desc" }] },
      },
    }),
    db.conversation.count({ where }),
  ]);
}

function updateAfterInbound(id, lastMessageAt, db = prisma) {
  const windowExpiresAt = new Date(lastMessageAt.getTime() + (24 * 60 * 60 * 1000));
  return db.conversation.update({
    where: { id },
    data: {
      lastMessageAt,
      unreadCount: { increment: 1 },
      lastInboundAt: lastMessageAt,
      customerServiceWindowOpenedAt: lastMessageAt,
      customerServiceWindowExpiresAt: windowExpiresAt,
      waitingForCustomerReply: false,
    },
    include: { contact: true },
  });
}

function updateLastMessageAt(id, lastMessageAt, db = prisma) {
  return db.conversation.update({ where: { id }, data: { lastMessageAt }, include: { contact: true } });
}

function updateAfterTemplate(id, { lastMessageAt, wamid, status }, db = prisma) {
  return db.conversation.update({
    where: { id },
    data: {
      lastMessageAt,
      conversationInitiated: true,
      conversationInitiatedAt: lastMessageAt,
      initialTemplateWamid: wamid,
      initialTemplateStatus: status,
      waitingForCustomerReply: true,
    },
    include: { contact: true },
  });
}

function updateInitialTemplateStatus(id, initialTemplateStatus, db = prisma) {
  return db.conversation.update({
    where: { id },
    data: { initialTemplateStatus },
    include: { contact: true },
  });
}

function markRead(id, db = prisma) {
  return db.conversation.update({ where: { id }, data: { unreadCount: 0 }, include: { contact: true } });
}

function updateStatus(id, status, db = prisma) {
  return db.conversation.update({ where: { id }, data: { status }, include: { contact: true } });
}

module.exports = {
  findOpenByContactId,
  createForContact,
  findById,
  list,
  updateAfterInbound,
  updateLastMessageAt,
  updateAfterTemplate,
  updateInitialTemplateStatus,
  markRead,
  updateStatus,
};
