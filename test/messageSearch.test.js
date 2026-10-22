const test = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../src/repositories/messageSearch.repository');
const { conversationListSchema } = require('../src/validators/conversation.validator');

test('pesquisa parametrizada agrupa por contato e canal, ordena pelo resultado mais recente e pagina no banco', async () => {
  const queries = [];
  const db = {
    $queryRaw: async (query) => {
      queries.push(query);
      return query.text.includes('COUNT(') ? [{ total: 19n }] : [
        { conversationId: 2, messageId: 42, matchedAt: new Date('2026-10-22'), matchedText: 'Pedido entregue' },
        { conversationId: 1, messageId: 40, matchedAt: new Date('2026-10-21'), matchedText: 'Pedido entregue' }
      ];
    },
    conversation: { findMany: async () => [{ id: 1 }, { id: 2 }] }
  };
  const [items, total] = await search({ messageSearch: "entregue%' OR 1=1 --", skip: 8, take: 8, channelId: 6 }, db);
  assert.deepEqual(items.map((c) => c.id), [2, 1]);
  assert.equal(total, 19);
  assert.equal(items[0].matchedMessage.type, 'text');
  assert.match(queries[0].text, /DISTINCT ON \(c\."contactId", c\."channelId"\)/);
  assert.match(queries[0].text, /ORDER BY "matchedAt" DESC, "messageId" DESC LIMIT/);
  assert.doesNotMatch(queries[0].text, /OR 1=1/);
  assert.ok(queries[0].values.some((v) => typeof v === 'string' && v.includes('\\%')));
  assert.deepEqual(queries[0].values.slice(-2), [8, 8]);
});

test('busca vazia ou excessivamente longa é rejeitada antes de consultar o banco', () => {
  assert.equal(conversationListSchema.safeParse({ messageSearch: 'a' }).success, false);
  assert.equal(conversationListSchema.safeParse({ messageSearch: 'x'.repeat(201) }).success, false);
  assert.equal(conversationListSchema.parse({ messageSearch: ' entrega ', assignment: 'ALL' }).messageSearch, 'entrega');
});
