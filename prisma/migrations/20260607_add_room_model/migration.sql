-- CreateTable
CREATE TABLE "Room" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE INDEX "Room_isActive_idx" ON "Room"("isActive");

-- AddRoomIdColumn
ALTER TABLE "Session" ADD COLUMN "roomId" INTEGER;

-- CreateIndex
CREATE INDEX "Session_roomId_idx" ON "Session"("roomId");

-- DataMigrationNote
-- 如果你有现有的场次数据，请先创建房间，然后手动更新 roomId 字段后再执行后续步骤
-- 例如：
-- UPDATE "Session" SET "roomId" = (SELECT id FROM "Room" WHERE name = '默认房间' LIMIT 1) WHERE "roomId" IS NULL;

-- AddForeignKey (uncomment after data migration)
-- ALTER TABLE "Session" ADD CONSTRAINT "Session_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropOldRoomColumn (uncomment after data migration)
-- ALTER TABLE "Session" DROP COLUMN "room";

-- AlterColumnNotNull (uncomment after data migration)
-- ALTER TABLE "Session" ALTER COLUMN "roomId" SET NOT NULL;
