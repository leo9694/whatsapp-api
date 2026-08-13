const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WHATSAPP_VERIFY_TOKEN = "local-test-token";
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

test("POST /api/messages/text valida os campos sem chamar a Meta", async () => {
  const response = await fetch(`${baseUrl}/api/messages/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "inválido", text: "Teste" }),
  });
  assert.equal(response.status, 400);
});
