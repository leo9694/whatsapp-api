ALTER TABLE "Conversation"
ADD COLUMN "conversationInitiated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "conversationInitiatedAt" TIMESTAMP(3),
ADD COLUMN "initialTemplateWamid" TEXT,
ADD COLUMN "initialTemplateStatus" "MessageStatus",
ADD COLUMN "lastInboundAt" TIMESTAMP(3),
ADD COLUMN "customerServiceWindowOpenedAt" TIMESTAMP(3),
ADD COLUMN "customerServiceWindowExpiresAt" TIMESTAMP(3),
ADD COLUMN "waitingForCustomerReply" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Message"
ADD COLUMN "templateData" JSONB,
ADD COLUMN "renderedText" TEXT;

CREATE INDEX "Conversation_initialTemplateWamid_idx" ON "Conversation"("initialTemplateWamid");
CREATE INDEX "Conversation_customerServiceWindowExpiresAt_idx" ON "Conversation"("customerServiceWindowExpiresAt");

-- Preserve currently open service windows from real inbound WhatsApp messages.
UPDATE "Conversation" AS conversation
SET
  "lastInboundAt" = inbound."messageTimestamp",
  "customerServiceWindowOpenedAt" = inbound."messageTimestamp",
  "customerServiceWindowExpiresAt" = inbound."messageTimestamp" + INTERVAL '24 hours'
FROM (
  SELECT DISTINCT ON ("conversationId") "conversationId", COALESCE("messageTimestamp", "createdAt") AS "messageTimestamp"
  FROM "Message"
  WHERE "direction" = 'INBOUND' AND "wamid" IS NOT NULL
  ORDER BY "conversationId", COALESCE("messageTimestamp", "createdAt") DESC
) AS inbound
WHERE conversation."id" = inbound."conversationId";

-- Preserve the latest template-based initiation state for existing conversations.
UPDATE "Conversation" AS conversation
SET
  "conversationInitiated" = true,
  "conversationInitiatedAt" = template."messageTimestamp",
  "initialTemplateWamid" = template."wamid",
  "initialTemplateStatus" = template."status",
  "waitingForCustomerReply" = NOT EXISTS (
    SELECT 1
    FROM "Message" AS inbound
    WHERE inbound."conversationId" = conversation."id"
      AND inbound."direction" = 'INBOUND'
      AND COALESCE(inbound."messageTimestamp", inbound."createdAt") > template."messageTimestamp"
  )
FROM (
  SELECT DISTINCT ON ("conversationId")
    "conversationId", "wamid", "status", COALESCE("messageTimestamp", "createdAt") AS "messageTimestamp"
  FROM "Message"
  WHERE "direction" = 'OUTBOUND' AND LOWER("type") = 'template' AND "wamid" IS NOT NULL
  ORDER BY "conversationId", COALESCE("messageTimestamp", "createdAt") DESC
) AS template
WHERE conversation."id" = template."conversationId";
