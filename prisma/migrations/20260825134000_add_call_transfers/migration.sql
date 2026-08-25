CREATE TYPE "CallTransferStatus" AS ENUM (
  'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'
);

ALTER TABLE "Call"
ADD COLUMN "currentAgentId" TEXT,
ADD COLUMN "currentAgentName" TEXT;

CREATE TABLE "CallTransfer" (
  "id" TEXT NOT NULL,
  "callId" INTEGER NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "fromAgentName" TEXT NOT NULL,
  "toAgentId" TEXT NOT NULL,
  "toAgentName" TEXT NOT NULL,
  "status" "CallTransferStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "mediaReadyAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Call_currentAgentId_status_idx" ON "Call"("currentAgentId", "status");
CREATE INDEX "CallTransfer_callId_requestedAt_idx" ON "CallTransfer"("callId", "requestedAt");
CREATE INDEX "CallTransfer_toAgentId_status_idx" ON "CallTransfer"("toAgentId", "status");
CREATE INDEX "CallTransfer_status_expiresAt_idx" ON "CallTransfer"("status", "expiresAt");

-- Impede duas transferências concorrentes para a mesma chamada, inclusive durante o handoff.
CREATE UNIQUE INDEX "CallTransfer_one_open_per_call"
ON "CallTransfer"("callId")
WHERE "status" IN ('PENDING', 'ACCEPTED');

ALTER TABLE "CallTransfer"
ADD CONSTRAINT "CallTransfer_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "Call"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
