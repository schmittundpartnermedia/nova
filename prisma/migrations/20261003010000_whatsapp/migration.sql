-- CreateTable
CREATE TABLE "whatsapp_kontakte" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "telefon" TEXT NOT NULL,
    "name" TEXT,
    "vorname" TEXT,
    "vorname_unsicher" BOOLEAN NOT NULL DEFAULT false,
    "zernio_id" TEXT,
    "gesperrt" BOOLEAN NOT NULL DEFAULT false,
    "sperr_grund" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "whatsapp_kontakte_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "whatsapp_kampagnen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vorlage" TEXT NOT NULL,
    "sprache" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'wartet_auf_freigabe',
    "pro_tag" INTEGER NOT NULL,
    "abstand_sekunden" INTEGER NOT NULL,
    "approval_id" TEXT,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "whatsapp_kampagnen_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "whatsapp_nachrichten" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "kampagne_id" TEXT,
    "telefon" TEXT NOT NULL,
    "name" TEXT,
    "richtung" TEXT NOT NULL,
    "art" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "zernio_id" TEXT,
    "gespraech_id" TEXT,
    "fehler" TEXT,
    "approval_id" TEXT,
    "geplant_fuer" DATETIME,
    "gesendet_at" DATETIME,
    "empfangen_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "whatsapp_nachrichten_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "whatsapp_nachrichten_kampagne_id_fkey" FOREIGN KEY ("kampagne_id") REFERENCES "whatsapp_kampagnen" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_kontakte_organization_id_telefon_key" ON "whatsapp_kontakte"("organization_id", "telefon");

-- CreateIndex
CREATE INDEX "whatsapp_kampagnen_organization_id_status_idx" ON "whatsapp_kampagnen"("organization_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_nachrichten_organization_id_telefon_idx" ON "whatsapp_nachrichten"("organization_id", "telefon");

-- CreateIndex
CREATE INDEX "whatsapp_nachrichten_kampagne_id_status_idx" ON "whatsapp_nachrichten"("kampagne_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_nachrichten_organization_id_zernio_id_key" ON "whatsapp_nachrichten"("organization_id", "zernio_id");

