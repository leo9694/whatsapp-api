const test = require("node:test");
const assert = require("node:assert/strict");
const { maskRecipient } = require("../src/services/whatsapp.service");

test("mascara o número de destino preservando início e final", () => {
  assert.equal(maskRecipient("556697212427"), "5566****2427");
});
