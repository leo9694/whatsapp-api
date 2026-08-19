const { z } = require("zod");

const { agentSchema } = require("./conversation.validator");

const textMessageSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  agent: agentSchema.optional(),
}).strict();
const reactionMessageSchema = z.object({
  messageId: z.string().trim().min(3).max(512).regex(/^[A-Za-z0-9._:=-]+$/),
  emoji: z.string().trim().min(1).max(16).refine((value) => !/[\r\n]/.test(value)),
  agent: agentSchema.optional(),
}).strict();
const legacyTextMessageSchema = z.object({
  to: z.string().trim().regex(/^\d{8,15}$/, "Use de 8 a 15 dígitos com código do país."),
  text: z.string().trim().min(1).max(4096),
}).strict();

module.exports = { textMessageSchema, reactionMessageSchema, legacyTextMessageSchema };
