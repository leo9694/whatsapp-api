const prisma = require("../database/prisma");

function findOpenByContactId(contactId, db = prisma) {
  return db.conversation.findFirst({
    where: { contactId, status: "OPEN" }, orderBy: { createdAt: "desc" }, include: { contact: true, channel: true },
  });
}

function findOpenByContactAndChannel(contactId, channelId, db = prisma) {
  return db.conversation.findFirst({
    where: { contactId, channelId, status: "OPEN" }, orderBy: { createdAt: "desc" },
    include: { contact: true, channel: true },
  });
}

function createForContact(contactId, db = prisma, phoneNumberId, channelId) {
  return db.conversation.create({
    data: { contactId, channelId, status: "OPEN", ...(phoneNumberId ? { phoneNumberId } : {}) },
    include: { contact: true, channel: true },
  });
}

function findById(id, db = prisma) {
  return db.conversation.findUnique({ where: { id }, include: { contact: true, channel: true } });
}

function list({ skip, take, search, status, assignment, viewerId, channelId, phoneNumberId }, db = prisma) {
  const where = {
    ...(status ? { status } : {}),
    ...(assignment === "MINE" ? { assignedUserId: viewerId } : {}),
    ...(assignment === "UNASSIGNED" ? { assignedUserId: null } : {}),
    ...(channelId ? { channelId } : {}),
    ...(phoneNumberId ? { channel: { phoneNumberId } } : {}),
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
        channel: true,
        messages: { take: 1, orderBy: [{ messageTimestamp: "desc" }, { createdAt: "desc" }] },
      },
    }),
    db.conversation.count({ where }),
  ]);
}

function updateAssignment(id, data, db = prisma) {
  return db.conversation.update({ where: { id }, data, include: { contact: true, channel: true } });
}

function updatePhoneNumberId(id, phoneNumberId, db = prisma) {
  if (!phoneNumberId) return findById(id, db);
  return db.conversation.update({ where: { id }, data: { phoneNumberId }, include: { contact: true, channel: true } });
}

function claimIfUnassigned(id, data, db = prisma) {
  return db.conversation.updateMany({ where: { id, assignedUserId: null }, data });
}

function createAssignmentHistory(data, db = prisma) {
  return db.conversationAssignment.create({ data });
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
    include: { contact: true, channel: true },
  });
}

function updateLastMessageAt(id, lastMessageAt, db = prisma) {
  return db.conversation.update({ where: { id }, data: { lastMessageAt }, include: { contact: true, channel: true } });
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
    include: { contact: true, channel: true },
  });
}

function updateInitialTemplateStatus(id, initialTemplateStatus, db = prisma) {
  return db.conversation.update({
    where: { id },
    data: { initialTemplateStatus },
    include: { contact: true, channel: true },
  });
}

function markRead(id, db = prisma) {
  return db.conversation.update({ where: { id }, data: { unreadCount: 0 }, include: { contact: true, channel: true } });
}

function updateStatus(id, status, db = prisma) {
  return db.conversation.update({ where: { id }, data: { status }, include: { contact: true, channel: true } });
}

function deleteById(id, db = prisma) {
  return db.conversation.delete({ where: { id } });
}

module.exports = {
  findOpenByContactId, findOpenByContactAndChannel, deleteById,
  createForContact,
  findById,
  list,
  updateAfterInbound,
  updateLastMessageAt,
  updateAfterTemplate,
  updateInitialTemplateStatus,
  markRead,
  updateStatus,
  updateAssignment,
  claimIfUnassigned,
  createAssignmentHistory,
  updatePhoneNumberId,
};
