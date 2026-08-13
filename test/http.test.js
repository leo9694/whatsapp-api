const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WHATSAPP_VERIFY_TOKEN = "local-test-token";
process.env.PRIVACY_CONTACT_EMAIL = "privacidade@nortesulsementes.com";
process.env.FRONTEND_URLS = '["https://chat.nortesulsementes.com"]';
process.env.INTERNAL_API_KEY = "internal-test-key";
const app = require("../src/server");

let server;
let baseUrl;

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
