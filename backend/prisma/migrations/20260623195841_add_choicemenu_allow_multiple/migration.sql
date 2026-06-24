-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChoiceMenu" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "requireOne" BOOLEAN NOT NULL DEFAULT false,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "appendToEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ChoiceMenu" ("appendToEnd", "createdAt", "id", "name", "requireOne") SELECT "appendToEnd", "createdAt", "id", "name", "requireOne" FROM "ChoiceMenu";
DROP TABLE "ChoiceMenu";
ALTER TABLE "new_ChoiceMenu" RENAME TO "ChoiceMenu";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
