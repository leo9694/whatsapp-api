const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("serviço do gateway permite netlink usado pelo Pion para descobrir rotas", () => {
  const servicePath = path.join(__dirname, "..", "media-gateway", "norte-sul-whatsapp-media.service");
  const service = fs.readFileSync(servicePath, "utf8");
  const families = service.match(/^RestrictAddressFamilies=(.+)$/m);

  assert.ok(families, "RestrictAddressFamilies deve estar configurado");
  assert.match(families[1], /(?:^|\s)AF_NETLINK(?:\s|$)/);
});
