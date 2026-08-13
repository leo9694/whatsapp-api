const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { io: createClient } = require("socket.io-client");
const { initializeSocket } = require("../src/sockets/socket");

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
