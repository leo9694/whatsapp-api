ALTER TABLE "Message"
ADD COLUMN "filename" TEXT,
ADD COLUMN "mediaSha256" TEXT,
ADD COLUMN "voice" BOOLEAN,
ADD COLUMN "durationSeconds" INTEGER,
ADD COLUMN "templateName" TEXT,
ADD COLUMN "templateLanguage" TEXT,
ADD COLUMN "templateComponents" JSONB;
