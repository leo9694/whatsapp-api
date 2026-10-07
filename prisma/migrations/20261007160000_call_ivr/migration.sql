ALTER TABLE "WhatsAppChannel" ADD COLUMN "callIvrConfig" JSONB;
ALTER TABLE "Call" ADD COLUMN "ivrState" JSONB;
