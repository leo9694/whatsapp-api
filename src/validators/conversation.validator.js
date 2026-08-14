const { z } = require("zod");

const idSchema = z.coerce.number().int().positive();
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const conversationListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]).optional(),
});
const conversationStatusSchema = z.object({ status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]) });
const createConversationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(24),
});

module.exports = {
  idSchema, paginationSchema, conversationListSchema, conversationStatusSchema, createConversationSchema,
};
