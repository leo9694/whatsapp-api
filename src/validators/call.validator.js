const { z } = require("zod");
const { agentSchema, paginationSchema, idSchema } = require("./conversation.validator");

const callIdSchema = z.string().trim().min(6).max(512).startsWith("wacid.");
const answerSessionSchema = z.object({
  sdpType: z.literal("answer"),
  sdp: z.string().min(20).max(262144),
}).strict();
const offerSessionSchema = z.object({
  sdpType: z.literal("offer"),
  sdp: z.string().min(20).max(262144),
}).strict();
const answerActionSchema = z.object({ session: answerSessionSchema, agent: agentSchema }).strict();
const agentActionSchema = z.object({ agent: agentSchema }).strict();
const permissionRequestSchema = z.object({
  agent: agentSchema,
  body: z.string().trim().min(1).max(1024).optional(),
}).strict();
const initiateCallSchema = z.object({ session: offerSessionSchema, agent: agentSchema }).strict();
const gatewayInitiateCallSchema = z.object({
  mediaSessionId: z.string().uuid(), agent: agentSchema,
}).strict();
const mediaJoinSchema = z.object({
  session: offerSessionSchema,
  transferId: z.string().uuid().optional(),
}).strict();
const mediaReadySchema = z.object({ transferId: z.string().uuid().optional() }).strict();
const transferRequestSchema = z.object({ targetAgentId: z.coerce.string().trim().min(1).max(64) }).strict();
const transferIdSchema = z.string().uuid();
const callListSchema = paginationSchema.extend({
  conversationId: idSchema.optional(),
  contactId: idSchema.optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  status: z.enum(["RINGING", "CONNECTING", "ACTIVE", "REJECTED", "MISSED", "BUSY", "FAILED", "ENDED"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

module.exports = {
  callIdSchema, answerActionSchema, agentActionSchema, permissionRequestSchema,
  initiateCallSchema: z.union([initiateCallSchema, gatewayInitiateCallSchema]), callListSchema,
  mediaJoinSchema, mediaReadySchema, transferIdSchema, transferRequestSchema,
};
