const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Readable } = require("node:stream");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");
const axios = require("axios");
const templateService = require("../src/services/template.service");
const mediaService = require("../src/services/media.service");
const whatsappService = require("../src/services/whatsapp.service");
const messageService = require("../src/services/message.service");
const conversationService = require("../src/services/conversation.service");
const mediaController = require("../src/controllers/media.controller");
const agent = { id: "72", name: "LEONARDO", signature: "Leonardo" };
const socket = require("../src/sockets/socket");
const { createFakePrisma } = require("./helpers/fakePrisma");
const execFileAsync = promisify(execFile);

const approvedTemplate = {
  id: "1", name: "pedido_aprovado", language: "pt_BR", status: "APPROVED", category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [
    { type: "HEADER", format: "TEXT", text: "Pedido {{1}}", example: { header_text: ["123"] } },
    { type: "BODY", text: "Olá {{1}}, seu pedido {{2}} foi aprovado.", example: { body_text: [["Leonardo", "123"]] } },
    { type: "FOOTER", text: "Norte Sul Sementes" },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Acompanhar", url: "https://example.com/{{1}}" }] },
  ],
};

test("lista, filtra e pagina templates aprovados", async () => {
  templateService.clearTemplateCache();
  const result = await templateService.listTemplates(
    { status: "APPROVED", page: 1, limit: 1 },
    { listMessageTemplates: async () => [approvedTemplate, { ...approvedTemplate, id: "2", name: "rejeitado", status: "REJECTED" }] },
  );
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].template.name, "pedido_aprovado");
  assert.equal(result.pagination.total, 1);
});

test("WhatsApp service percorre paginação da Graph API ao listar templates", async () => {
  const originalFetch = global.fetch;
  process.env.WHATSAPP_ACCESS_TOKEN = "EAA-test-token";
  process.env.WHATSAPP_WABA_ID = "123";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "456";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => calls === 1
      ? { data: [approvedTemplate], paging: { next: "https://graph.facebook.com/next" } }
      : { data: [{ ...approvedTemplate, id: "2", name: "segunda" }] } };
  };
  try {
    const templates = await whatsappService.listMessageTemplates();
    assert.equal(calls, 2);
    assert.equal(templates.length, 2);
  } finally { global.fetch = originalFetch; }
});

test("envia áudio OGG como mensagem de voz", async () => {
  const originalFetch = global.fetch;
  process.env.WHATSAPP_ACCESS_TOKEN = "EAA-test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "456";
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.audio" }] }) };
  };
  try {
    await whatsappService.sendAudioMessage("5565999999999", "media-audio", { voice: true });
    assert.deepEqual(body.audio, { id: "media-audio", voice: true });
  } finally { global.fetch = originalFetch; }
});

test("gera preview e informa parâmetros ausentes sem enviar à Meta", async () => {
  templateService.clearTemplateCache();
  const dependencies = { listMessageTemplates: async () => [approvedTemplate] };
  const valid = await templateService.previewTemplate({
    name: "pedido_aprovado", language: "pt_BR", parameters: { header: ["123"], body: ["Leonardo", "123"] },
  }, dependencies);
  assert.equal(valid.body, "Olá Leonardo, seu pedido 123 foi aprovado.");
  assert.equal(valid.valid, true);

  templateService.clearTemplateCache();
  const missing = await templateService.previewTemplate({
    name: "pedido_aprovado", language: "pt_BR", parameters: { body: ["Leonardo"] },
  }, dependencies);
  assert.equal(missing.valid, false);
  assert.ok(missing.missingParameters.length >= 2);
});

async function seedConversation(db) {
  return messageService.processInboundMessage({
    message: { id: "wamid.in", from: "5565999999999", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Olá" } },
    contacts: [{ wa_id: "5565999999999", profile: { name: "Cliente" } }],
  }, { db });
}

test("envia template aprovado com Meta mockada e persiste outbound", async () => {
  const db = createFakePrisma();
  const created = await conversationService.createConversation({ name: "Leonardo", phone: "5565999999999" }, db);
  await conversationService.changeAssignment(created.conversation.id, { action: "CLAIM", actor: agent, target: agent }, db);
  const events = [];
  const originalEmit = socket.emit;
  socket.emit = (event, payload) => events.push({ event, payload });
  let message;
  try {
    message = await conversationService.sendTemplate(created.conversation.id, {
      templateName: "pedido_aprovado", language: "pt_BR",
      components: [
        { type: "header", parameters: [{ type: "text", text: "123" }] },
        { type: "body", parameters: [{ type: "text", text: "Leonardo" }, { type: "text", text: "123" }] },
      ],
    }, agent, {
      db,
      findTemplate: async () => ({ template: templateService.normalizeTemplate(approvedTemplate) }),
      sendTemplateMessage: async () => ({ messages: [{ id: "wamid.template" }] }),
    });
  } finally { socket.emit = originalEmit; }
  assert.equal(message.type, "template");
  assert.equal(message.wamid, "wamid.template");
  assert.equal(message.templateName, "pedido_aprovado");
  assert.equal(message.renderedText, "Olá Leonardo, seu pedido 123 foi aprovado.");
  assert.equal(message.templateData.body, message.renderedText);
  assert.equal(db.state.conversations[0].conversationInitiated, true);
  assert.equal(db.state.conversations[0].initialTemplateWamid, "wamid.template");
  assert.equal(db.state.conversations[0].initialTemplateStatus, "SENT");
  assert.equal(db.state.conversations[0].waitingForCustomerReply, true);
  assert.equal(db.state.conversations[0].customerServiceWindowOpenedAt, null);
  assert.equal(db.state.conversations[0].customerServiceWindowExpiresAt, null);
  assert.ok(events.some((item) => item.event === "message:new" && item.payload.message.template.body === message.renderedText));
  assert.ok(events.some((item) => item.event === "conversation:updated"));

  const statusEvents = [];
  const originalStatusEmit = socket.emit;
  socket.emit = (event, payload) => statusEvents.push({ event, payload });
  try {
    await messageService.processStatus({ id: "wamid.template", status: "delivered" }, db);
    assert.equal(db.state.conversations[0].initialTemplateStatus, "DELIVERED");
    await messageService.processStatus({ id: "wamid.template", status: "read" }, db);
    assert.equal(db.state.conversations[0].initialTemplateStatus, "READ");
  } finally { socket.emit = originalStatusEmit; }
  assert.equal(statusEvents.filter((item) => item.event === "message:status").length, 2);
  assert.equal(statusEvents.filter((item) => item.event === "conversation:updated").length, 2);

  const reply = await messageService.processInboundMessage({
    message: { id: "wamid.customer.reply", from: "5565999999999", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Obrigado" } },
    contacts: [{ wa_id: "5565999999999", profile: { name: "Leonardo" } }],
  }, { db });
  assert.equal(reply.conversation.waitingForCustomerReply, false);
  assert.equal(reply.conversation.serviceWindow.canSendFreeform, true);
  assert.equal(reply.conversation.serviceWindow.requiresTemplate, false);

  const history = await conversationService.listMessages(created.conversation.id, { page: 1, limit: 30 }, db);
  const templateMessage = history.data.find((item) => item.type === "template");
  assert.equal(templateMessage.template.name, "pedido_aprovado");
  assert.equal(templateMessage.template.body, "Olá Leonardo, seu pedido 123 foi aprovado.");
});

for (const [type, payload] of [
  ["image", { id: "media-image", mime_type: "image/jpeg", sha256: "abc", caption: "Foto" }],
  ["audio", { id: "media-audio", mime_type: "audio/ogg", sha256: "def", voice: true }],
  ["document", { id: "media-document", mime_type: "application/pdf", sha256: "ghi", filename: "pedido.pdf", caption: "Pedido" }],
  ["video", { id: "media-video", mime_type: "video/mp4", sha256: "jkl", caption: "Vídeo" }],
]) {
  test(`salva metadados inbound de ${type}`, async () => {
    const db = createFakePrisma();
    const result = await messageService.processInboundMessage({
      message: { id: `wamid.${type}`, from: "5565999999999", timestamp: "1700000000", type, [type]: payload },
      contacts: [],
    }, { db });
    assert.equal(result.message.mediaId, payload.id);
    assert.equal(result.message.mimeType, payload.mime_type);
    assert.equal(result.message.mediaSha256, payload.sha256);
    if (type === "audio") assert.equal(result.message.voice, true);
    if (type === "document") assert.equal(result.message.filename, "pedido.pdf");
  });
}

test("valida MIME real, faz upload mockado e limpa arquivo temporário", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-media-"));
  const filePath = path.join(directory, "random-name");
  await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]));
  const file = { path: filePath, size: 6, mimetype: "image/jpeg", originalname: "../foto?.jpg" };
  const uploaded = await mediaService.upload(file, "image", {
    uploadMedia: async (input) => ({ id: input.mimeType === "image/jpeg" ? "media-1" : null }),
  });
  assert.equal(uploaded.mediaId, "media-1");
  assert.equal(uploaded.filename, "foto_.jpg");
  await mediaService.cleanupUpload(file);
  await assert.rejects(fs.access(filePath));
  await fs.rm(directory, { recursive: true, force: true });
});

test("envia OGG/Opus com o MIME de upload aceito pela Meta", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-ogg-"));
  const filePath = path.join(directory, "gravacao.ogg");
  await fs.writeFile(filePath, Buffer.from("OggS-test"));
  const file = { path: filePath, size: 9, mimetype: "audio/ogg", originalname: "gravacao.ogg" };
  let uploadInput;
  try {
    const uploaded = await mediaService.upload(file, "audio", {
      uploadMedia: async (input) => {
        uploadInput = input;
        return { id: "media-ogg" };
      },
    });
    assert.equal(uploadInput.mimeType, "audio/ogg");
    assert.equal(uploaded.mimeType, "audio/ogg");
  } finally {
    await mediaService.cleanupUpload(file);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("converte gravação WebM do navegador para OGG/Opus", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-webm-"));
  const inputPath = path.join(directory, "browser-recording");
  let converted;
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-t", "0.1", "-c:a", "libopus", "-f", "webm", inputPath,
    ]);
    const stat = await fs.stat(inputPath);
    const input = { path: inputPath, size: stat.size, mimetype: "audio/webm;codecs=opus", originalname: "gravacao.webm" };
    assert.equal((await mediaService.validateUpload(input, "audio")).mimeType, "audio/webm");
    converted = await mediaService.transcodeWebmToOgg(input);
    assert.equal(converted.mimetype, "audio/ogg");
    assert.equal(converted.originalname, "gravacao.ogg");
    assert.equal(await mediaService.sniffMime(converted.path, converted.mimetype), "audio/ogg");
    const ogg = await fs.readFile(converted.path);
    const opusHead = ogg.indexOf(Buffer.from("OpusHead"));
    assert.notEqual(opusHead, -1);
    assert.equal(ogg[opusHead + 9], 1);
  } finally {
    await mediaService.cleanupUpload(converted);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("identifica gravação WebM quando o navegador declara MIME genérico", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-webm-generic-"));
  const inputPath = path.join(directory, "gravacao.webm");
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
      "-t", "0.1", "-c:a", "libopus", "-f", "webm", inputPath,
    ]);
    const stat = await fs.stat(inputPath);
    const metadata = await mediaService.validateUpload({
      path: inputPath, size: stat.size, mimetype: "application/octet-stream", originalname: "gravacao.webm"
    }, "audio");
    assert.equal(metadata.mimeType, "audio/webm");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejeita MIME inválido e arquivo acima do limite", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-media-"));
  const filePath = path.join(directory, "file");
  await fs.writeFile(filePath, "não é imagem");
  await assert.rejects(mediaService.validateUpload({ path: filePath, size: 12, mimetype: "image/jpeg", originalname: "x.jpg" }, "image"), /não corresponde/);
  await assert.rejects(mediaService.validateUpload({ path: filePath, size: 6 * 1024 * 1024, mimetype: "image/jpeg", originalname: "x.jpg" }, "image"), /limite/);
  await fs.rm(directory, { recursive: true, force: true });
});

test("controller remove upload temporário quando envio falha", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nsw-media-"));
  const filePath = path.join(directory, "temporary");
  await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));
  const originalSendMedia = conversationService.sendMedia;
  conversationService.sendMedia = async () => { throw new Error("Meta indisponível"); };
  const req = { params: { id: "1" }, body: { agent: JSON.stringify(agent) }, file: { path: filePath, size: 3, mimetype: "image/jpeg", originalname: "x.jpg" } };
  const res = {};
  let receivedError;
  try {
    await mediaController.sendImage(req, res, (error) => { receivedError = error; });
    assert.match(receivedError.message, /Meta indisponível/);
    await assert.rejects(fs.access(filePath));
  } finally {
    conversationService.sendMedia = originalSendMedia;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("envia image, document, video e audio com upload e Meta mockados", async () => {
  for (const kind of ["image", "document", "video", "audio"]) {
    const db = createFakePrisma();
    const seeded = await seedConversation(db);
    await conversationService.changeAssignment(seeded.conversation.id, { action: "CLAIM", actor: agent, target: agent }, db);
    const message = await conversationService.sendMedia(seeded.conversation.id, kind, {}, { voice: kind === "audio" }, agent, {
      db,
      upload: async () => ({ mediaId: `media-${kind}`, mimeType: kind === "document" ? "application/pdf" : `${kind}/mock`, filename: `file.${kind}` }),
      [`send${kind[0].toUpperCase()}${kind.slice(1)}Message`]: async () => ({ messages: [{ id: `wamid.${kind}` }] }),
    });
    assert.equal(message.type, kind);
    assert.equal(message.mediaId, `media-${kind}`);
  }
});

test("download de mídia obtém URL e retorna stream sem expor token", async () => {
  const originalFetch = global.fetch;
  const originalGet = axios.get;
  process.env.WHATSAPP_ACCESS_TOKEN = "EAA-secret";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "456";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ url: "https://lookaside.fbsbx.com/media", mime_type: "audio/ogg" }) });
  axios.get = async (_url, options) => {
    assert.match(options.headers.Authorization, /^Bearer /);
    return { data: Readable.from([Buffer.from("audio")]), headers: { "content-type": "audio/ogg", "content-length": "5" } };
  };
  try {
    const result = await whatsappService.downloadMedia("media-1");
    assert.equal(result.headers["content-type"], "audio/ogg");
    assert.equal(result.metadata.url, "https://lookaside.fbsbx.com/media");
  } finally { global.fetch = originalFetch; axios.get = originalGet; }
});
