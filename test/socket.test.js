const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { io: createClient } = require("socket.io-client");
const { emitToAgent, initializeSocket } = require("../src/sockets/socket");

function agentToken({ id, environment }, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: "norte-sul-atendimento",
    aud: "norte-sul-whatsapp-api",
    sub: id,
    name: id,
    environment,
    iat: now,
    exp: now + 300,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("Socket.IO exige a API key configurada e aceita cliente autorizado", async () => {
  process.env.INTERNAL_API_KEY = "socket-test-key";
  const server = http.createServer();
  const io = initializeSocket(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const unauthorized = createClient(url, { transports: ["websocket"], reconnection: false });
  const unauthorizedMessage = await new Promise((resolve) => {
    unauthorized.on("connect_error", (error) => resolve(error.message));
  });
  assert.equal(unauthorizedMessage, "Não autorizado.");
  unauthorized.close();

  const authorized = createClient(url, {
    transports: ["websocket"],
    reconnection: false,
    auth: { apiKey: "socket-test-key" },
  });
  await new Promise((resolve, reject) => {
    authorized.on("connect", resolve);
    authorized.on("connect_error", reject);
  });
  assert.equal(authorized.connected, true);
  authorized.close();

  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  delete process.env.INTERNAL_API_KEY;
});

test("entrega eventos de chamada aos ambientes local e production configurados", async () => {
  process.env.INTERNAL_API_KEY = "socket-multi-env-key";
  process.env.CALL_AGENT_AUTH_SECRET = "socket-multi-env-secret-with-32-chars";
  process.env.CALL_DELIVERY_ENVS = "local,production";
  const server = http.createServer();
  const io = initializeSocket(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const clients = ["local", "production"].map((environment) => createClient(url, {
    transports: ["websocket"],
    reconnection: false,
    auth: {
      apiKey: "socket-multi-env-key",
      agentToken: agentToken({ id: "72", environment }, process.env.CALL_AGENT_AUTH_SECRET),
    },
  }));
  await Promise.all(clients.map((client) => new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("connect_error", reject);
  })));

  const received = clients.map((client) => new Promise((resolve) => client.once("call:incoming", resolve)));
  emitToAgent("72", "call:incoming", { callId: "call-both-envs" });
  const payloads = await Promise.all(received);
  assert.deepEqual(payloads.map((payload) => payload.callId), ["call-both-envs", "call-both-envs"]);

  clients.forEach((client) => client.close());
  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  delete process.env.INTERNAL_API_KEY;
  delete process.env.CALL_AGENT_AUTH_SECRET;
  delete process.env.CALL_DELIVERY_ENVS;
});
