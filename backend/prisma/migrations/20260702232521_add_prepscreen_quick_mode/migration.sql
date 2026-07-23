-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PrepScreen" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isTakeaway" BOOLEAN NOT NULL DEFAULT false,
    "quickMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PrepScreen" ("createdAt", "id", "isTakeaway", "name", "slug", "sort") SELECT "createdAt", "id", "isTakeaway", "name", "slug", "sort" FROM "PrepScreen";
DROP TABLE "PrepScreen";
ALTER TABLE "new_PrepScreen" RENAME TO "PrepScreen";
CREATE UNIQUE INDEX "PrepScreen_slug_key" ON "PrepScreen"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
