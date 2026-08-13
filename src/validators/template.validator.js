const { z } = require("zod");

const templateListSchema = z.object({
  status: z.string().trim().max(50).optional(),
  language: z.string().trim().max(20).optional(),
  category: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
  refresh: z.string().optional().transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const templateNameSchema = z.string().trim().regex(/^[a-z0-9_]{1,512}$/);
const languageSchema = z.string().trim().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/);
const previewSchema = z.object({
  name: templateNameSchema,
  language: languageSchema,
  parameters: z.object({
    header: z.array(z.union([z.string(), z.number()])).optional(),
    body: z.array(z.union([z.string(), z.number()])).optional(),
  }).default({}),
}).strict();
const sendTemplateSchema = z.object({
  templateName: templateNameSchema,
  language: languageSchema,
  components: z.array(z.record(z.string(), z.unknown())).default([]),
}).strict();

module.exports = { templateListSchema, templateNameSchema, languageSchema, previewSchema, sendTemplateSchema };
