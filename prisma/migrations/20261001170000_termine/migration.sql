-- CreateTable
CREATE TABLE "termine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "beginn" DATETIME NOT NULL,
    "dauer_minuten" INTEGER NOT NULL DEFAULT 30,
    "notiz" TEXT,
    "erinnerung_minuten" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'geplant',
    "quelle_id" TEXT,
    "kalender_name" TEXT,
    "kalender_uid" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "termine_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "termine_organization_id_beginn_idx" ON "termine"("organization_id", "beginn");

