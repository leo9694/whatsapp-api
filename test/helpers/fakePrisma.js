function matchesContactSearch(contact, search) {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [contact.name, contact.profileName, contact.phone, contact.waId]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function createFakePrisma() {
  const state = { contacts: [], conversations: [], messages: [] };
  const next = { contact: 1, conversation: 1, message: 1 };
  const now = () => new Date();

  const db = {
    state,
    $transaction: (callback) => callback(db),
    contact: {
      async upsert({ where, create, update }) {
        let item = state.contacts.find((contact) => contact.waId === where.waId);
        if (item) Object.assign(item, update, { updatedAt: now() });
        else {
          item = { id: next.contact++, ...create, createdAt: now(), updatedAt: now() };
          state.contacts.push(item);
        }
        return { ...item };
      },
    },
    conversation: {
      async findFirst({ where }) {
        const items = state.conversations.filter((item) =>
          item.contactId === where.contactId && (!where.status || item.status === where.status));
        return items.length ? { ...items.at(-1) } : null;
      },
      async create({ data }) {
        const item = {
          id: next.conversation++, status: "OPEN", assignedUserId: null, unreadCount: 0,
          lastMessageAt: null, createdAt: now(), updatedAt: now(), ...data,
        };
        state.conversations.push(item);
        return { ...item };
      },
      async findUnique({ where, include }) {
        const item = state.conversations.find((conversation) => conversation.id === where.id);
        if (!item) return null;
        const result = { ...item };
        if (include?.contact) result.contact = { ...state.contacts.find((contact) => contact.id === item.contactId) };
        return result;
      },
      async update({ where, data, include }) {
        const item = state.conversations.find((conversation) => conversation.id === where.id);
        if (!item) throw Object.assign(new Error("not found"), { code: "P2025" });
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) item[key] += value.increment;
          else item[key] = value;
        }
        item.updatedAt = now();
        const result = { ...item };
        if (include?.contact) result.contact = { ...state.contacts.find((contact) => contact.id === item.contactId) };
        return result;
      },
      async findMany({ where = {}, skip = 0, take = 30 }) {
        let items = state.conversations.filter((item) => {
          if (where.status && item.status !== where.status) return false;
          const contact = state.contacts.find((candidate) => candidate.id === item.contactId);
          const search = where.contact?.OR?.[0]?.name?.contains;
          return matchesContactSearch(contact, search);
        });
        items = items.sort((a, b) => (b.lastMessageAt || b.updatedAt) - (a.lastMessageAt || a.updatedAt));
        return items.slice(skip, skip + take).map((item) => {
          const messages = state.messages
            .filter((message) => message.conversationId === item.id)
            .sort((a, b) => (b.messageTimestamp || b.createdAt) - (a.messageTimestamp || a.createdAt));
          return {
            ...item,
            contact: { ...state.contacts.find((contact) => contact.id === item.contactId) },
            messages: messages.slice(0, 1).map((message) => ({ ...message })),
          };
        });
      },
      async count({ where = {} }) {
        return state.conversations.filter((item) => {
          if (where.status && item.status !== where.status) return false;
          const contact = state.contacts.find((candidate) => candidate.id === item.contactId);
          const search = where.contact?.OR?.[0]?.name?.contains;
          return matchesContactSearch(contact, search);
        }).length;
      },
    },
    message: {
      async findUnique({ where }) {
        const item = where.wamid !== undefined
          ? state.messages.find((message) => message.wamid === where.wamid)
          : state.messages.find((message) => message.id === where.id);
        return item ? { ...item } : null;
      },
      async create({ data }) {
        if (data.wamid && state.messages.some((message) => message.wamid === data.wamid)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const item = { id: next.message++, createdAt: now(), updatedAt: now(), ...data };
        state.messages.push(item);
        return { ...item };
      },
      async findMany({ where, skip = 0, take = 30 }) {
        return state.messages.filter((item) => item.conversationId === where.conversationId)
          .sort((a, b) => (b.messageTimestamp || b.createdAt) - (a.messageTimestamp || a.createdAt))
          .slice(skip, skip + take).map((item) => ({ ...item }));
      },
      async count({ where }) {
        return state.messages.filter((item) => item.conversationId === where.conversationId).length;
      },
      async update({ where, data }) {
        const item = state.messages.find((message) => message.wamid === where.wamid);
        if (!item) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(item, data, { updatedAt: now() });
        return { ...item };
      },
      async findFirst({ where }) {
        const items = state.messages.filter((item) => item.conversationId === where.conversationId
          && item.direction === where.direction && item.wamid);
        return items.length ? { ...items.sort((a, b) => (b.messageTimestamp || b.createdAt) - (a.messageTimestamp || a.createdAt))[0] } : null;
      },
    },
  };
  return db;
}

module.exports = { createFakePrisma };
