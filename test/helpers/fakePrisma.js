function matchesContactSearch(contact, search) {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [contact.name, contact.profileName, contact.phone, contact.waId]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function createFakePrisma() {
  const state = { contacts: [], conversations: [], messages: [], assignments: [], calls: [] };
  const next = { contact: 1, conversation: 1, message: 1, assignment: 1, call: 1 };
  const now = () => new Date();

  const db = {
    state,
    $transaction: (callback) => callback(db),
    contact: {
      async findUnique({ where }) {
        const item = state.contacts.find((contact) => contact.waId === where.waId || contact.id === where.id);
        return item ? { ...item } : null;
      },
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
          id: next.conversation++, status: "OPEN", assignedUserId: null, assignedUserName: null,
          assignedAt: null, unreadCount: 0,
          phoneNumberId: null,
          lastMessageAt: null, conversationInitiated: false, conversationInitiatedAt: null,
          initialTemplateWamid: null, initialTemplateStatus: null, lastInboundAt: null,
          customerServiceWindowOpenedAt: null, customerServiceWindowExpiresAt: null,
          waitingForCustomerReply: false, createdAt: now(), updatedAt: now(), ...data,
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
      async updateMany({ where, data }) {
        const items = state.conversations.filter((conversation) => conversation.id === where.id
          && conversation.assignedUserId === where.assignedUserId);
        items.forEach((item) => Object.assign(item, data, { updatedAt: now() }));
        return { count: items.length };
      },
      async delete({ where }) {
        const index = state.conversations.findIndex((conversation) => conversation.id === where.id);
        if (index < 0) throw Object.assign(new Error("not found"), { code: "P2025" });
        const [removed] = state.conversations.splice(index, 1);
        state.messages = state.messages.filter((message) => message.conversationId !== where.id);
        return { ...removed };
      },
      async findMany({ where = {}, skip = 0, take = 30 }) {
        let items = state.conversations.filter((item) => {
          if (where.status && item.status !== where.status) return false;
          if (Object.prototype.hasOwnProperty.call(where, "assignedUserId") && item.assignedUserId !== where.assignedUserId) return false;
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
          if (Object.prototype.hasOwnProperty.call(where, "assignedUserId") && item.assignedUserId !== where.assignedUserId) return false;
          const contact = state.contacts.find((candidate) => candidate.id === item.contactId);
          const search = where.contact?.OR?.[0]?.name?.contains;
          return matchesContactSearch(contact, search);
        }).length;
      },
    },
    conversationAssignment: {
      async create({ data }) {
        const item = { id: next.assignment++, createdAt: now(), ...data };
        state.assignments.push(item);
        return { ...item };
      },
    },
    call: {
      includeRelations(item, include) {
        const result = { ...item };
        if (include?.contact) result.contact = item.contactId
          ? { ...state.contacts.find((contact) => contact.id === item.contactId) } : null;
        if (include?.conversation) result.conversation = item.conversationId
          ? { ...state.conversations.find((conversation) => conversation.id === item.conversationId) } : null;
        return result;
      },
      async findUnique({ where, include }) {
        const item = state.calls.find((call) => call.metaCallId === where.metaCallId || call.id === where.id);
        return item ? this.includeRelations(item, include) : null;
      },
      async create({ data, include }) {
        if (state.calls.some((call) => call.metaCallId === data.metaCallId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const item = { id: next.call++, createdAt: now(), updatedAt: now(), ...data };
        state.calls.push(item);
        return this.includeRelations(item, include);
      },
      async update({ where, data, include }) {
        const item = state.calls.find((call) => call.metaCallId === where.metaCallId);
        if (!item) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(item, data, { updatedAt: now() });
        return this.includeRelations(item, include);
      },
      async findMany({ where = {}, skip = 0, take = 30, include }) {
        return state.calls.filter((item) => {
          if (where.conversationId && item.conversationId !== where.conversationId) return false;
          if (where.contactId && item.contactId !== where.contactId) return false;
          if (where.direction && item.direction !== where.direction) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.createdAt?.gte && item.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lt && item.createdAt >= where.createdAt.lt) return false;
          return true;
        }).sort((a, b) => b.createdAt - a.createdAt)
          .slice(skip, skip + take).map((item) => this.includeRelations(item, include));
      },
      async count({ where = {} }) {
        return state.calls.filter((item) => {
          if (where.conversationId && item.conversationId !== where.conversationId) return false;
          if (where.contactId && item.contactId !== where.contactId) return false;
          if (where.direction && item.direction !== where.direction) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.createdAt?.gte && item.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lt && item.createdAt >= where.createdAt.lt) return false;
          return true;
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
