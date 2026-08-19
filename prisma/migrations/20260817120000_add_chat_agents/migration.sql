ALTER TABLE "Conversation"
ADD COLUMN "assignedUserName" TEXT,
ADD COLUMN "assignedAt" TIMESTAMP(3);

ALTER TABLE "Message"
ADD COLUMN "senderUserId" TEXT,
ADD COLUMN "senderUserName" TEXT;

CREATE TABLE "ConversationAssignment" (
  "id" SERIAL NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorUserName" TEXT NOT NULL,
  "targetUserId" TEXT,
  "targetUserName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationAssignment_conversationId_createdAt_idx"
ON "ConversationAssignment"("conversationId", "createdAt");

ALTER TABLE "ConversationAssignment"
ADD CONSTRAINT "ConversationAssignment_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
