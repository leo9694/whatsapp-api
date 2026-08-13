const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakePrisma } = require("./helpers/fakePrisma");
const messageService = require("../src/services/message.service");
const conversationService = require("../src/services/conversation.service");

function inbound(id = "wamid.1", from = "5565999999999", type = "text") {
  return {
    message: {
      id,
      from,
      timestamp: "1700000000",
      type,
      ...(type === "text" ? { text: { body: "Olá" } } : {}),
    },
    contacts: [{ wa_id: from, profile: { name: "Cliente Teste" } }],
  };
}

test("cria contato, conversa e mensagem inbound e incrementa unreadCount", async () => {
  const db = createFakePrisma();
  const result = await messageService.processInboundMessage(inbound(), { db });
  assert.equal(db.state.contacts.length, 1);
  assert.equal(db.state.contacts[0].profileName, "Cliente Teste");
  assert.equal(db.state.conversations.length, 1);
  assert.equal(result.conversation.unreadCount, 1);
  assert.equal(result.message.direction, "INBOUND");
});

test("não duplica mensagem com o mesmo wamid", async () => {
  const db = createFakePrisma();
  await messageService.processInboundMessage(inbound(), { db });
  const duplicate = await messageService.processInboundMessage(inbound(), { db });
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.state.messages.length, 1);
  assert.equal(db.state.conversations[0].unreadCount, 1);
});

test("atualiza status de mensagem pelo wamid", async () => {
  const db = createFakePrisma();
  await messageService.processInboundMessage(inbound(), { db });
  const updated = await messageService.processStatus({ id: "wamid.1", status: "read" }, db);
  assert.equal(updated.status, "READ");
});

test("aceita payload de tipo desconhecido sem falhar", async () => {
  const db = createFakePrisma();
  const result = await messageService.processInboundMessage(inbound("wamid.unknown", undefined, "future_type"), { db });
  assert.equal(result.message.type, "future_type");
  assert.equal(result.message.text, null);
});

test("lista conversas com paginação, filtro por status e busca", async () => {
  const db = createFakePrisma();
  await messageService.processInboundMessage(inbound("wamid.1", "5565111111111"), { db });
  await messageService.processInboundMessage({
    ...inbound("wamid.2", "5565222222222"),
    contacts: [{ wa_id: "5565222222222", profile: { name: "Maria Oliveira" } }],
  }, { db });
  db.state.conversations[0].status = "CLOSED";

  const filtered = await conversationService.listConversations({ page: 1, limit: 30, search: "Maria", status: "OPEN" }, db);
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0].contact.profileName, "Maria Oliveira");
  assert.deepEqual(filtered.pagination, { page: 1, limit: 30, total: 1, totalPages: 1 });
});

test("marca conversa como lida e prepara mark-as-read na Meta", async () => {
  const db = createFakePrisma();
  const inboundResult = await messageService.processInboundMessage(inbound(), { db });
  let markedWamid;
  const result = await conversationService.markRead(inboundResult.conversation.id, {
    db,
    markMessageAsRead: async (wamid) => { markedWamid = wamid; return { success: true }; },
  });
  assert.equal(result.conversation.unreadCount, 0);
  assert.equal(result.metaMarked, true);
  assert.equal(markedWamid, "wamid.1");
});

test("envia por conversationId com Meta mockada e salva outbound", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  let destination;
  const message = await conversationService.sendText(received.conversation.id, "Resposta", {
    db,
    sendTextMessage: async (to) => {
      destination = to;
      return { messages: [{ id: "wamid.outbound" }] };
    },
  });
  assert.equal(destination, "5565999999999");
  assert.equal(message.direction, "OUTBOUND");
  assert.equal(message.status, "SENT");
});

test("propaga erro da Meta sem salvar mensagem outbound", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await assert.rejects(
    conversationService.sendText(received.conversation.id, "Resposta", {
      db,
      sendTextMessage: async () => { throw Object.assign(new Error("Meta indisponível"), { status: 502 }); },
    }),
    /Meta indisponível/,
  );
  assert.equal(db.state.messages.filter((item) => item.direction === "OUTBOUND").length, 0);
});

test("fecha, reabre e arquiva conversa", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  for (const status of ["CLOSED", "OPEN", "ARCHIVED"]) {
    const updated = await conversationService.changeStatus(received.conversation.id, status, db);
    assert.equal(updated.status, status);
  }
});

test("informa indisponibilidade do banco", async () => {
  const unavailableDb = {
    conversation: {
      findMany: async () => { throw new Error("database unavailable"); },
      count: async () => { throw new Error("database unavailable"); },
    },
  };
  await assert.rejects(
    conversationService.listConversations({ page: 1, limit: 30 }, unavailableDb),
    /database unavailable/,
  );
});
