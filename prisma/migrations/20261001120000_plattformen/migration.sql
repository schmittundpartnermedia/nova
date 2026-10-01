-- CreateTable
CREATE TABLE "plattformen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kategorie" TEXT,
    "begruendung" TEXT,
    "konto_angelegt" BOOLEAN NOT NULL DEFAULT false,
    "profil_ausgefuellt" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'offen',
    "letzter_schritt" TEXT,
    "naechster_schritt" TEXT,
    "reihenfolge" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "plattformen_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "plattformen_organization_id_name_key" ON "plattformen"("organization_id", "name");

