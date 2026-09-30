-- Nachfass-Mails: Einstellung je Kampagne, Werte der Vorlage und Bezug auf die erste Mail.
ALTER TABLE "campaigns" ADD COLUMN "nachfass_tage" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "nachfass_vorlage" TEXT;
ALTER TABLE "communications" ADD COLUMN "vorlagen_werte" TEXT;
ALTER TABLE "communications" ADD COLUMN "nachfass_zu" TEXT;
