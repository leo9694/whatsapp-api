const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.WHATSAPP_VERIFY_TOKEN = "local-test-token";
process.env.PRIVACY_CONTACT_EMAIL = "privacidade@nortesulsementes.com";
process.env.FRONTEND_URLS = '["https://chat.nortesulsementes.com"]';
process.env.INTERNAL_API_KEY = "internal-test-key";
process.env.CALL_AGENT_AUTH_SECRET = "segredo-hmac-de-teste-com-mais-de-32-caracteres";
const app = require("../src/server");
const conversationService = require("../src/services/conversation.service");

let server;
let baseUrl;

function agentToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: "norte-sul-atendimento", aud: "norte-sul-whatsapp-api",
    sub: "72", name: "Agente Teste", iat: now, exp: now + 60,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.CALL_AGENT_AUTH_SECRET)
    .update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("GET /health retorna o estado da aplicação", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /webhook/whatsapp devolve o challenge com token correto", async () => {
  const query = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": "local-test-token",
    "hub.challenge": "123456",
  });
  const response = await fetch(`${baseUrl}/webhook/whatsapp?${query}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "123456");
});

test("GET /webhook/whatsapp rejeita token incorreto", async () => {
  const response = await fetch(
    `${baseUrl}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
  );
  assert.equal(response.status, 403);
});

test("POST /webhook/whatsapp aceita payload inesperado sem falhar", async () => {
  const response = await fetch(`${baseUrl}/webhook/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unexpected: true }),
  });
  assert.equal(response.status, 200);
});

test("POST /webhook/whatsapp registra metadados seguros antes do processamento", async () => {
  const records = [];
  const originalLog = console.log;
  console.log = (line) => records.push(JSON.parse(line));

  try {
    const response = await fetch(`${baseUrl}/webhook/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "auditoria-local/1.0",
      },
      body: JSON.stringify({ object: "test" }),
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.log = originalLog;
  }

  const rawRequest = records.find((record) => record.event === "raw_webhook_request");
  assert.deepEqual(
    {
      method: rawRequest?.method,
      path: rawRequest?.path,
      contentType: rawRequest?.contentType,
      userAgent: rawRequest?.userAgent,
    },
    {
      method: "POST",
      path: "/webhook/whatsapp",
      contentType: "application/json",
      userAgent: "auditoria-local/1.0",
    },
  );
  assert.equal("authorization" in rawRequest, false);
});

test("POST /api/messages/text valida os campos sem chamar a Meta", async () => {
  const response = await fetch(`${baseUrl}/api/messages/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
    body: JSON.stringify({ to: "inválido", text: "Teste" }),
  });
  assert.equal(response.status, 400);
});

test("protege /api com X-API-Key quando configurada", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/messages/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${baseUrl}/api/messages/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
    body: JSON.stringify({}),
  });
  assert.equal(authorized.status, 400);
});

test("POST /api/conversations responde 201/200 conforme criação ou reutilização", async () => {
  const originalCreate = conversationService.createConversation;
  let calls = 0;
  conversationService.createConversation = async ({ name, phone }) => {
    calls += 1;
    const created = calls === 1;
    return {
      conversation: { id: 10, status: "OPEN", serviceWindow: { canSendFreeform: false, requiresTemplate: true } },
      contact: { id: 20, name, phone, waId: phone },
      created,
    };
  };
  try {
    for (const expectedStatus of [201, 200]) {
      const response = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
        body: JSON.stringify({ name: "Leo teste", phone: "556696988891" }),
      });
      const body = await response.json();
      assert.equal(response.status, expectedStatus);
      assert.equal(body.success, true);
      assert.equal(body.data.created, expectedStatus === 201);
    }
  } finally { conversationService.createConversation = originalCreate; }
});

test("POST /api/conversations rejeita nome ou telefone inválido sem acessar serviço", async () => {
  const response = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
    body: JSON.stringify({ name: "L", phone: "9999" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

for (const [method, path] of [
  ["GET", "/api/templates"],
  ["POST", "/api/templates/preview"],
  ["POST", "/api/conversations"],
  ["GET", "/api/media/media-123"],
  ["POST", "/api/conversations/1/messages/image"],
  ["GET", "/api/calls"],
  ["POST", "/api/calls/wacid.test/accept"],
]) {
  test(`${method} ${path} exige autenticação`, async () => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAUTHORIZED");
  });
}

test("POST /api/calls/:callId/accept rejeita SDP inválido antes de acessar a Meta", async () => {
  const response = await fetch(`${baseUrl}/api/calls/wacid.test/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": "internal-test-key" },
    body: JSON.stringify({ session: { sdpType: "answer", sdp: "inválido" }, agent: { id: "1", name: "Agente" } }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("rotas individuais de chamada exigem identidade assinada do atendente", async () => {
  const denied = await fetch(`${baseUrl}/api/call-agents`, {
    headers: { "X-API-Key": "internal-test-key" },
  });
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${baseUrl}/api/call-agents`, {
    headers: { "X-API-Key": "internal-test-key", "X-Agent-Token": agentToken() },
  });
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray((await allowed.json()).data));
});

test("CORS permite origem da whitelist e rejeita origem desconhecida", async () => {
  const allowed = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://chat.nortesulsementes.com" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://chat.nortesulsementes.com");

  const blocked = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://malicioso.example" } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

for (const path of [
  "/politica-de-privacidade",
  "/termos-de-servico",
  "/exclusao-de-dados",
]) {
  test(`GET ${path} retorna uma página HTML pública`, async () => {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.match(body, /Norte Sul Sementes LTDA/);
    assert.match(body, /Norte Sul Chat/);
    assert.doesNotMatch(body, /google-analytics|googletagmanager/i);
  });
}

test("página de exclusão exibe o email configurado", async () => {
  const response = await fetch(`${baseUrl}/exclusao-de-dados`);
  const body = await response.text();

  assert.match(body, /privacidade@nortesulsementes\.com/);
  assert.match(body, /mailto:privacidade@nortesulsementes\.com/);
});
