const { z } = require("zod");

const textMessageSchema = z.object({ text: z.string().trim().min(1).max(4096) }).strict();
const legacyTextMessageSchema = z.object({
  to: z.string().trim().regex(/^\d{8,15}$/, "Use de 8 a 15 dígitos com código do país."),
  text: z.string().trim().min(1).max(4096),
}).strict();

module.exports = { textMessageSchema, legacyTextMessageSchema };
