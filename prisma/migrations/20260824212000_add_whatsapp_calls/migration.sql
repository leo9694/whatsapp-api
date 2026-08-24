CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'CONNECTING', 'ACTIVE', 'REJECTED', 'MISSED', 'BUSY', 'FAILED', 'ENDED');

ALTER TABLE "Conversation"
ADD COLUMN "phoneNumberId" TEXT;

CREATE TABLE "Call" (
  "id" SERIAL NOT NULL,
  "metaCallId" TEXT NOT NULL,
  "conversationId" INTEGER,
  "contactId" INTEGER,
  "phoneNumberId" TEXT NOT NULL,
  "direction" "CallDirection" NOT NULL,
  "status" "CallStatus" NOT NULL,
  "remotePhone" TEXT,
  "startedAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "endReason" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Call_metaCallId_key" ON "Call"("metaCallId");
CREATE INDEX "Call_conversationId_createdAt_idx" ON "Call"("conversationId", "createdAt");
CREATE INDEX "Call_contactId_createdAt_idx" ON "Call"("contactId", "createdAt");
CREATE INDEX "Call_phoneNumberId_status_idx" ON "Call"("phoneNumberId", "status");
CREATE INDEX "Call_direction_status_createdAt_idx" ON "Call"("direction", "status", "createdAt");

ALTER TABLE "Call"
ADD CONSTRAINT "Call_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Call"
ADD CONSTRAINT "Call_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
