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

-- Step 1: Add roomId column (nullable)
ALTER TABLE "Session" ADD COLUMN "roomId" INTEGER;

-- CreateIndex
CREATE INDEX "Session_roomId_idx" ON "Session"("roomId");

-- Step 2: Data migration for existing sessions
-- 注意：如果你有现有的场次数据，需要先创建房间，再执行以下数据迁移
-- 可以在应用迁移前通过 API 创建默认房间，然后执行：
-- INSERT INTO "Room" (name, capacity, "isActive") VALUES ('默认房间', 8, true) ON CONFLICT DO NOTHING;
-- UPDATE "Session" SET "roomId" = (SELECT id FROM "Room" WHERE name = '默认房间' LIMIT 1) WHERE "roomId" IS NULL;

-- Step 3: Add foreign key constraint
ALTER TABLE "Session" ADD CONSTRAINT "Session_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Drop old room column
ALTER TABLE "Session" DROP COLUMN "room";

-- Step 5: Set roomId to NOT NULL
ALTER TABLE "Session" ALTER COLUMN "roomId" SET NOT NULL;
