-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "closedAt" DATETIME,
    "deliveryMode" TEXT NOT NULL DEFAULT 'EAT_IN',
    "note" TEXT,
    "locationId" INTEGER,
    "tableId" INTEGER,
    "tableLabel" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "payMethod" TEXT NOT NULL DEFAULT 'ON_DELIVERY',
    "cancelToken" TEXT NOT NULL DEFAULT 'pend',
    "cancelledAt" DATETIME,
    CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("cancelToken", "cancelledAt", "closedAt", "createdAt", "customerEmail", "customerName", "customerPhone", "deliveryMode", "id", "locationId", "note", "payMethod", "status", "tableId", "tableLabel") SELECT "cancelToken", "cancelledAt", "closedAt", "createdAt", "customerEmail", "customerName", "customerPhone", "deliveryMode", "id", "locationId", "note", "payMethod", "status", "tableId", "tableLabel" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_cancelToken_key" ON "Order"("cancelToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
