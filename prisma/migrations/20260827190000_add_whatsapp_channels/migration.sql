CREATE TABLE "WhatsAppChannel" (
  "id" SERIAL NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "displayPhoneNumber" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "wabaId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppChannel_phoneNumberId_key" ON "WhatsAppChannel"("phoneNumberId");
CREATE INDEX "WhatsAppChannel_isActive_isDefault_idx" ON "WhatsAppChannel"("isActive", "isDefault");
CREATE UNIQUE INDEX "WhatsAppChannel_single_default_key" ON "WhatsAppChannel"("isDefault") WHERE "isDefault" = true;

INSERT INTO "WhatsAppChannel" (
  "phoneNumberId", "displayPhoneNumber", "displayName", "isActive", "isDefault"
) VALUES
  ('1226938830493899', '+55 65 4042-0707', 'Norte Sul Sementes', true, true),
  ('1272418099287669', '+55 66 9215-1618', 'Norte Sul | Atendimento Comercial', true, false);

ALTER TABLE "Conversation" ADD COLUMN "channelId" INTEGER;
ALTER TABLE "Call" ADD COLUMN "channelId" INTEGER;
ALTER TABLE "CallPermission" ADD COLUMN "channelId" INTEGER;

UPDATE "Conversation" AS conversation
SET "phoneNumberId" = COALESCE(conversation."phoneNumberId", '1226938830493899'),
    "channelId" = channel."id"
FROM "WhatsAppChannel" AS channel
WHERE channel."phoneNumberId" = COALESCE(conversation."phoneNumberId", '1226938830493899');

UPDATE "Conversation"
SET "phoneNumberId" = '1226938830493899',
    "channelId" = (SELECT "id" FROM "WhatsAppChannel" WHERE "isDefault" = true)
WHERE "channelId" IS NULL;

UPDATE "Call" AS call
SET "channelId" = COALESCE(
  (SELECT conversation."channelId" FROM "Conversation" AS conversation WHERE conversation."id" = call."conversationId"),
  (SELECT channel."id" FROM "WhatsAppChannel" AS channel WHERE channel."phoneNumberId" = call."phoneNumberId"),
  (SELECT channel."id" FROM "WhatsAppChannel" AS channel WHERE channel."isDefault" = true)
);

UPDATE "CallPermission" AS permission
SET "channelId" = COALESCE(
  (SELECT conversation."channelId" FROM "Conversation" AS conversation WHERE conversation."id" = permission."conversationId"),
  (SELECT channel."id" FROM "WhatsAppChannel" AS channel WHERE channel."phoneNumberId" = permission."phoneNumberId"),
  (SELECT channel."id" FROM "WhatsAppChannel" AS channel WHERE channel."isDefault" = true)
);

ALTER TABLE "Conversation" ALTER COLUMN "channelId" SET NOT NULL;
ALTER TABLE "Call" ALTER COLUMN "channelId" SET NOT NULL;
ALTER TABLE "CallPermission" ALTER COLUMN "channelId" SET NOT NULL;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallPermission" ADD CONSTRAINT "CallPermission_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Conversation_contactId_channelId_status_idx" ON "Conversation"("contactId", "channelId", "status");
CREATE INDEX "Conversation_channelId_lastMessageAt_idx" ON "Conversation"("channelId", "lastMessageAt");
CREATE INDEX "Call_channelId_status_idx" ON "Call"("channelId", "status");
CREATE INDEX "CallPermission_channelId_status_idx" ON "CallPermission"("channelId", "status");
