const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageDeduplicator } = require("../src/utils/messageDeduplicator");

test("identifica uma mensagem repetida dentro do TTL", () => {
  const deduplicator = new MessageDeduplicator({ ttlMs: 1000 });
  assert.equal(deduplicator.isDuplicate("wamid.1", 100), false);
  assert.equal(deduplicator.isDuplicate("wamid.1", 500), true);
});

test("aceita novamente uma mensagem depois do TTL", () => {
  const deduplicator = new MessageDeduplicator({ ttlMs: 1000 });
  assert.equal(deduplicator.isDuplicate("wamid.1", 100), false);
  assert.equal(deduplicator.isDuplicate("wamid.1", 1100), false);
});
