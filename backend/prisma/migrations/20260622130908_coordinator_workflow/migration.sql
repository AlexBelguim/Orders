-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Location" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DELIVERY',
    "deliveryNote" TEXT,
    "deliveryEtaMin" INTEGER,
    "minOrderCents" INTEGER,
    "openFrom" TEXT,
    "openUntil" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prepScreenId" INTEGER,
    "coordinatorScreenId" INTEGER,
    CONSTRAINT "Location_prepScreenId_fkey" FOREIGN KEY ("prepScreenId") REFERENCES "PrepScreen" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Location_coordinatorScreenId_fkey" FOREIGN KEY ("coordinatorScreenId") REFERENCES "PrepScreen" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Location" ("code", "createdAt", "deliveryEtaMin", "deliveryNote", "id", "kind", "minOrderCents", "name", "openFrom", "openUntil", "prepScreenId") SELECT "code", "createdAt", "deliveryEtaMin", "deliveryNote", "id", "kind", "minOrderCents", "name", "openFrom", "openUntil", "prepScreenId" FROM "Location";
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "lineNote" TEXT,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "commissionCents" INTEGER NOT NULL DEFAULT 0,
    "prepScreenId" INTEGER,
    "itemStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "itemDoneAt" DATETIME,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_prepScreenId_fkey" FOREIGN KEY ("prepScreenId") REFERENCES "PrepScreen" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("commissionCents", "id", "lineNote", "orderId", "prepScreenId", "qty", "unitPriceCents", "variantId") SELECT "commissionCents", "id", "lineNote", "orderId", "prepScreenId", "qty", "unitPriceCents", "variantId" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
