const { z } = require("zod");

const idSchema = z.coerce.number().int().positive();
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const conversationListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]).optional(),
  assignment: z.enum(["ALL", "MINE", "UNASSIGNED"]).default("MINE"),
  viewerId: z.string().trim().min(1).max(64).optional(),
  channelId: z.coerce.number().int().positive().optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,32}$/).optional(),
});
const agentSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  signature: z.string().trim().max(80).optional(),
  director: z.boolean().optional(),
}).strict();
const conversationStatusSchema = z.object({
  status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]),
  agent: agentSchema.optional(),
}).strict();
const assignmentSchema = z.object({
  action: z.enum(["CLAIM", "TRANSFER", "RELEASE"]),
  actor: agentSchema,
  target: agentSchema.pick({ id: true, name: true }).optional(),
}).strict();
const createConversationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(24),
  channelId: z.coerce.number().int().positive().optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,32}$/).optional(),
}).strict();

module.exports = {
  agentSchema, assignmentSchema, idSchema, paginationSchema, conversationListSchema,
  conversationStatusSchema, createConversationSchema,
};
