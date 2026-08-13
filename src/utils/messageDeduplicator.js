const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

class MessageDeduplicator {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.processedIds = new Map();
  }

  isDuplicate(messageId, now = Date.now()) {
    if (!messageId) return false;

    this.removeExpired(now);
    const processedAt = this.processedIds.get(messageId);

    if (processedAt !== undefined && now - processedAt < this.ttlMs) {
      return true;
    }

    this.processedIds.set(messageId, now);
    this.enforceLimit();
    return false;
  }

  removeExpired(now = Date.now()) {
    for (const [id, processedAt] of this.processedIds) {
      if (now - processedAt >= this.ttlMs) this.processedIds.delete(id);
    }
  }

  enforceLimit() {
    while (this.processedIds.size > this.maxEntries) {
      const oldestId = this.processedIds.keys().next().value;
      this.processedIds.delete(oldestId);
    }
  }
}

module.exports = new MessageDeduplicator();
module.exports.MessageDeduplicator = MessageDeduplicator;
