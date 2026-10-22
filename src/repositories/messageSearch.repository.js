const { Prisma } = require('@prisma/client');

async function search({ messageSearch, skip, take, channelId, phoneNumberId, status, search }, db) {
  const pattern = `%${messageSearch.replace(/[\\%_]/g, '\\$&')}%`;
  const where = Prisma.sql`
    (COALESCE(m.text, '') || ' ' || COALESCE(m.caption, '') || ' ' || COALESCE(m."renderedText", '')) ILIKE ${pattern}
    ${channelId ? Prisma.sql`AND c."channelId" = ${channelId}` : Prisma.empty}
    ${phoneNumberId ? Prisma.sql`AND ch."phoneNumberId" = ${phoneNumberId}` : Prisma.empty}
    ${status ? Prisma.sql`AND c.status::text = ${status}` : Prisma.empty}
    ${search ? Prisma.sql`AND (p.name ILIKE ${`%${search.replace(/[\\%_]/g, '\\$&')}%`} OR p."profileName" ILIKE ${`%${search.replace(/[\\%_]/g, '\\$&')}%`} OR p.phone LIKE ${`%${search.replace(/[\\%_]/g, '\\$&')}%`})` : Prisma.empty}
  `;
  const from = Prisma.sql`FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
    JOIN "Contact" p ON p.id = c."contactId" JOIN "WhatsAppChannel" ch ON ch.id = c."channelId" WHERE ${where}`;
  const [matches, counts] = await Promise.all([
    db.$queryRaw(Prisma.sql`SELECT * FROM (
      SELECT DISTINCT ON (c."contactId", c."channelId") m."conversationId", m.id AS "messageId",
        COALESCE(m."messageTimestamp", m."createdAt") AS "matchedAt",
        COALESCE(NULLIF(m.text, ''), NULLIF(m.caption, ''), m."renderedText") AS "matchedText"
      ${from} ORDER BY c."contactId", c."channelId", COALESCE(m."messageTimestamp", m."createdAt") DESC, m.id DESC
    ) matched ORDER BY "matchedAt" DESC, "messageId" DESC LIMIT ${take} OFFSET ${skip}`),
    db.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT (c."contactId", c."channelId")) AS total ${from}`)
  ]);
  const conversations = matches.length ? await db.conversation.findMany({
    where: { id: { in: matches.map((m) => m.conversationId) } },
    include: { contact: true, channel: true, messages: { take: 1, orderBy: [{ messageTimestamp: 'desc' }, { createdAt: 'desc' }] } }
  }) : [];
  const byId = new Map(conversations.map((c) => [c.id, c]));
  return [matches.filter((m) => byId.has(m.conversationId)).map((m) => ({ ...byId.get(m.conversationId),
    matchedMessage: { id: m.messageId, type: 'text', text: m.matchedText, messageTimestamp: m.matchedAt } })), Number(counts[0]?.total || 0)];
}

module.exports = { search };
