CREATE TYPE "CallPermissionStatus" AS ENUM (
  'PENDING', 'GRANTED', 'DENIED', 'EXPIRED', 'REVOKED'
);

CREATE TABLE "CallPermission" (
  "id" SERIAL NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "contactId" INTEGER NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "status" "CallPermissionStatus" NOT NULL,
  "canStartCall" BOOLEAN NOT NULL DEFAULT false,
  "isPermanent" BOOLEAN NOT NULL DEFAULT false,
  "metaStatus" TEXT,
  "responseSource" TEXT,
  "requestedByAgentId" TEXT,
  "requestedByAgentName" TEXT,
  "requestedAt" TIMESTAMP(3),
  "grantedAt" TIMESTAMP(3),
  "deniedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "metaReference" TEXT,
  "lastWebhookWamid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallPermission_lastWebhookWamid_key" ON "CallPermission"("lastWebhookWamid");
CREATE UNIQUE INDEX "CallPermission_conversationId_phoneNumberId_key" ON "CallPermission"("conversationId", "phoneNumberId");
CREATE INDEX "CallPermission_contactId_phoneNumberId_idx" ON "CallPermission"("contactId", "phoneNumberId");
CREATE INDEX "CallPermission_status_expiresAt_idx" ON "CallPermission"("status", "expiresAt");

ALTER TABLE "CallPermission"
ADD CONSTRAINT "CallPermission_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallPermission"
ADD CONSTRAINT "CallPermission_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
