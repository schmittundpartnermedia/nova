-- Phase 2: Entwürfe tragen Absender, Empfänger und Antwortbezug selbst.
ALTER TABLE "communications" ADD COLUMN "from_address" TEXT;
ALTER TABLE "communications" ADD COLUMN "to_address" TEXT;
ALTER TABLE "communications" ADD COLUMN "reply_ref" TEXT;

-- Neustart der Dauerfreigaben: alte Testfreigaben (u. a. UI-Klicks) werden widerrufen, nicht gelöscht.
UPDATE "approval_policies" SET "revoked_at" = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE "revoked_at" IS NULL;
