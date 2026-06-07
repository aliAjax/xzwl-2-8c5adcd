-- CreateStoreTable
CREATE TABLE "Store" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateHostStoreTable
CREATE TABLE "HostStore" (
    "hostId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostStore_pkey" PRIMARY KEY ("hostId","storeId")
);

-- AddStoreIdColumnToScript
ALTER TABLE "Script" ADD COLUMN "storeId" INTEGER;

-- AddStoreIdColumnToRoom
ALTER TABLE "Room" ADD COLUMN "storeId" INTEGER;

-- AddStoreIdColumnToSession
ALTER TABLE "Session" ADD COLUMN "storeId" INTEGER;

-- InsertDefaultStore
INSERT INTO "Store" ("id", "name", "address", "phone", "isActive", "createdAt", "updatedAt")
VALUES (1, '默认门店', NULL, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ResetSequenceForStore
ALTER SEQUENCE "Store_id_seq" RESTART WITH 2;

-- MigrateExistingScriptsToDefaultStore
UPDATE "Script" SET "storeId" = 1 WHERE "storeId" IS NULL;

-- MigrateExistingRoomsToDefaultStore
UPDATE "Room" SET "storeId" = 1 WHERE "storeId" IS NULL;

-- MigrateExistingSessionsToDefaultStore
UPDATE "Session" SET "storeId" = 1 WHERE "storeId" IS NULL;

-- CreateHostStoreEntriesForExistingHosts
INSERT INTO "HostStore" ("hostId", "storeId", "isActive", "createdAt", "updatedAt")
SELECT "id", 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Host"
ON CONFLICT ("hostId", "storeId") DO NOTHING;

-- MakeStoreIdNotNullInScript
ALTER TABLE "Script" ALTER COLUMN "storeId" SET NOT NULL;

-- MakeStoreIdNotNullInRoom
ALTER TABLE "Room" ALTER COLUMN "storeId" SET NOT NULL;

-- MakeStoreIdNotNullInSession
ALTER TABLE "Session" ALTER COLUMN "storeId" SET NOT NULL;

-- DropOldUniqueConstraintOnScriptName
ALTER TABLE "Script" DROP CONSTRAINT IF EXISTS "Script_name_key";

-- DropOldUniqueConstraintOnRoomName
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS "Room_name_key";

-- AddCompositeUniqueConstraintScriptStoreName
ALTER TABLE "Script" ADD CONSTRAINT "Script_storeId_name_key" UNIQUE ("storeId", "name");

-- AddCompositeUniqueConstraintRoomStoreName
ALTER TABLE "Room" ADD CONSTRAINT "Room_storeId_name_key" UNIQUE ("storeId", "name");

-- AddUniqueStoreName
ALTER TABLE "Store" ADD CONSTRAINT "Store_name_key" UNIQUE ("name");

-- AddForeignKeyScriptStore
ALTER TABLE "Script" ADD CONSTRAINT "Script_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKeyRoomStore
ALTER TABLE "Room" ADD CONSTRAINT "Room_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKeySessionStore
ALTER TABLE "Session" ADD CONSTRAINT "Session_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKeyHostStoreHost
ALTER TABLE "HostStore" ADD CONSTRAINT "HostStore_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKeyHostStoreStore
ALTER TABLE "HostStore" ADD CONSTRAINT "HostStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndexStoreIsActive
CREATE INDEX "Store_isActive_idx" ON "Store"("isActive");

-- CreateIndexHostStoreStoreId
CREATE INDEX "HostStore_storeId_idx" ON "HostStore"("storeId");

-- CreateIndexHostStoreHostId
CREATE INDEX "HostStore_hostId_idx" ON "HostStore"("hostId");

-- CreateIndexScriptStoreId
CREATE INDEX "Script_storeId_idx" ON "Script"("storeId");

-- CreateIndexRoomStoreId
CREATE INDEX "Room_storeId_idx" ON "Room"("storeId");

-- CreateIndexSessionStoreId
CREATE INDEX "Session_storeId_idx" ON "Session"("storeId");

-- CreateIndexSessionStoreTime
CREATE INDEX "Session_storeId_startTime_endTime_idx" ON "Session"("storeId", "startTime", "endTime");
