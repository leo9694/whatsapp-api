const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakePrisma } = require("./helpers/fakePrisma");
const messageService = require("../src/services/message.service");
const conversationService = require("../src/services/conversation.service");
const socket = require("../src/sockets/socket");
const agent = { id: "72", name: "LEONARDO", signature: "Leonardo" };

async function claim(db, conversationId) {
  return conversationService.changeAssignment(conversationId, { action: "CLAIM", actor: agent, target: agent }, db);
}

function inbound(id = "wamid.1", from = "5565999999999", type = "text") {
  return {
    message: {
      id,
      from,
      timestamp: String(Math.floor(Date.now() / 1000)),
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

test("preserva o motivo informado pela Meta quando o envio falha", async () => {
  const db = createFakePrisma();
  await messageService.processInboundMessage(inbound(), { db });
  const errors = [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable" }];
  const updated = await messageService.processStatus({ id: "wamid.1", status: "failed", errors }, db);
  assert.equal(updated.status, "FAILED");
  assert.deepEqual(updated.failureDetails, errors);
});

test("aceita payload de tipo desconhecido sem falhar", async () => {
  const db = createFakePrisma();
  const result = await messageService.processInboundMessage(inbound("wamid.unknown", undefined, "future_type"), { db });
  assert.equal(result.message.type, "future_type");
  assert.equal(result.message.text, null);
});

test("converte resposta de botão do template em texto inbound", async () => {
  const db = createFakePrisma();
  const result = await messageService.processInboundMessage({
    message: {
      id: "wamid.button.reply",
      from: "5565999999999",
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "confirmar", title: "Sim!" } },
    },
    contacts: [{ wa_id: "5565999999999", profile: { name: "Cliente Teste" } }],
  }, { db });
  assert.equal(result.message.type, "text");
  assert.equal(result.message.text, "Sim!");
  assert.equal(result.conversation.serviceWindow.canSendFreeform, true);
});

test("lista conversas com paginação, filtro por status e busca", async () => {
  const db = createFakePrisma();
  await messageService.processInboundMessage(inbound("wamid.1", "5565111111111"), { db });
  await messageService.processInboundMessage({
    ...inbound("wamid.2", "5565222222222"),
    contacts: [{ wa_id: "5565222222222", profile: { name: "Maria Oliveira" } }],
  }, { db });
  db.state.conversations[0].status = "CLOSED";

  const filtered = await conversationService.listConversations({ page: 1, limit: 30, search: "Maria", status: "OPEN", assignment: "ALL" }, db);
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
  await claim(db, received.conversation.id);
  let destination;
  const message = await conversationService.sendText(received.conversation.id, "Resposta", agent, {
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

test("envia reação para a mensagem da conversa e salva o vínculo", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await claim(db, received.conversation.id);
  let request;
  const message = await conversationService.sendReaction(
    received.conversation.id,
    "wamid.1",
    "👍",
    agent,
    {
      db,
      sendReactionMessage: async (to, messageId, emoji) => {
        request = { to, messageId, emoji };
        return { messages: [{ id: "wamid.reaction.outbound" }] };
      },
    },
  );
  assert.deepEqual(request, { to: "5565999999999", messageId: "wamid.1", emoji: "👍" });
  assert.equal(message.type, "reaction");
  assert.deepEqual(JSON.parse(message.text), { message_id: "wamid.1", emoji: "👍" });
});

test("não reage a mensagem que não pertence à conversa", async () => {
  const db = createFakePrisma();
  const first = await messageService.processInboundMessage(inbound("wamid.first", "5565111111111"), { db });
  await messageService.processInboundMessage(inbound("wamid.other", "5565222222222"), { db });
  await claim(db, first.conversation.id);
  await assert.rejects(
    conversationService.sendReaction(first.conversation.id, "wamid.other", "❤️", agent, {
      db,
      sendReactionMessage: async () => ({ messages: [{ id: "unused" }] }),
    }),
    /não pertence a esta conversa/,
  );
});

test("cria contato/conversa, reutiliza OPEN e não chama a Meta", async () => {
  const db = createFakePrisma();
  const events = [];
  const originalEmit = socket.emit;
  socket.emit = (event, payload) => events.push({ event, payload });
  let first;
  let reused;
  try {
    first = await conversationService.createConversation({
      name: "Contato novo", phone: "+55 (65) 99999-9999",
    }, db);
    reused = await conversationService.createConversation({
      name: "Contato atualizado", phone: "5565999999999",
    }, db);
  } finally { socket.emit = originalEmit; }

  assert.equal(first.created, true);
  assert.equal(reused.created, false);
  assert.equal(first.contact.waId, "5565999999999");
  assert.equal(reused.contact.name, "Contato atualizado");
  assert.equal(first.conversation.id, reused.conversation.id);
  assert.equal(first.conversation.requiresTemplate, true);
  assert.equal(db.state.contacts.length, 1);
  assert.equal(db.state.conversations.length, 1);
  assert.equal(db.state.messages.length, 0);
  assert.equal(events.filter((item) => item.event === "conversation:new").length, 1);
  await claim(db, first.conversation.id);
  await assert.rejects(
    conversationService.sendText(first.conversation.id, "Olá", agent, { db, sendTextMessage: async () => ({}) }),
    /template aprovado/,
  );
});

test("rejeita telefone sem DDI/DDD válido", async () => {
  const db = createFakePrisma();
  await assert.rejects(
    conversationService.createConversation({ name: "Contato", phone: "99999-9999" }, db),
    /WhatsApp valido/,
  );
});

test("informa janela Meta fechada quando a Ãºltima mensagem do cliente passou de 24 horas", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await claim(db, received.conversation.id);
  db.state.conversations[0].customerServiceWindowExpiresAt = new Date(Date.now() - 1000);
  const conversation = await conversationService.getConversation(received.conversation.id, db);
  assert.equal(conversation.requiresTemplate, true);
  assert.equal(conversation.metaWindow.status, "CLOSED");
});

test("inbound abre e renova a janela de atendimento por 24 horas", async () => {
  const db = createFakePrisma();
  const firstAt = new Date(Date.now() - (60 * 60 * 1000));
  const first = inbound("wamid.window.1");
  first.message.timestamp = String(Math.floor(firstAt.getTime() / 1000));
  const firstResult = await messageService.processInboundMessage(first, { db });
  const firstExpiry = new Date(firstResult.conversation.serviceWindow.expiresAt);
  assert.equal(firstResult.conversation.serviceWindow.canSendFreeform, true);

  const secondAt = new Date();
  const second = inbound("wamid.window.2");
  second.message.timestamp = String(Math.floor(secondAt.getTime() / 1000));
  const secondResult = await messageService.processInboundMessage(second, { db });
  const secondExpiry = new Date(secondResult.conversation.serviceWindow.expiresAt);
  assert.ok(secondExpiry > firstExpiry);
  assert.equal(secondResult.conversation.waitingForCustomerReply, false);
  assert.ok(Math.abs(secondExpiry.getTime() - (Math.floor(secondAt.getTime() / 1000) * 1000 + 86400000)) < 10);
});

test("propaga erro da Meta sem salvar mensagem outbound", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await claim(db, received.conversation.id);
  await assert.rejects(
    conversationService.sendText(received.conversation.id, "Resposta", agent, {
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
  await claim(db, received.conversation.id);
  for (const status of ["CLOSED", "OPEN", "ARCHIVED"]) {
    const updated = await conversationService.changeStatus(received.conversation.id, status, agent, db);
    assert.equal(updated.status, status);
  }
});

test("exclui somente a conversa e suas mensagens, preservando o contato", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  const deleted = await conversationService.deleteConversation(received.conversation.id, db);
  assert.equal(deleted.deleted, true);
  assert.equal(db.state.conversations.length, 0);
  assert.equal(db.state.messages.length, 0);
  assert.equal(db.state.contacts.length, 1);
});

test("informa indisponibilidade do banco", async () => {
  const unavailableDb = {
    conversation: {
      findMany: async () => { throw new Error("database unavailable"); },
      count: async () => { throw new Error("database unavailable"); },
    },
  };
  await assert.rejects(
    conversationService.listConversations({ page: 1, limit: 30, assignment: "ALL" }, unavailableDb),
    /database unavailable/,
  );
});

test("somente o atendente responsavel envia e a assinatura e persistida", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await claim(db, received.conversation.id);
  await assert.rejects(
    conversationService.sendText(received.conversation.id, "Teste", { id: "99", name: "OUTRO" }, { db }),
    /LEONARDO/,
  );
  const message = await conversationService.sendText(received.conversation.id, "Teste", agent, {
    db, sendTextMessage: async (_to, text) => ({ messages: [{ id: text }] }),
  });
  assert.equal(message.text, "*Leonardo:*\nTeste");
  assert.equal(message.senderUserId, "72");
});

test("nao permite que outro atendente tome uma conversa ja assumida", async () => {
  const db = createFakePrisma();
  const received = await messageService.processInboundMessage(inbound(), { db });
  await claim(db, received.conversation.id);
  await assert.rejects(
    conversationService.changeAssignment(received.conversation.id, {
      action: "CLAIM", actor: { id: "99", name: "OUTRO" }, target: { id: "99", name: "OUTRO" },
    }, db),
    /LEONARDO/,
  );
  assert.equal(db.state.conversations[0].assignedUserId, "72");
});
