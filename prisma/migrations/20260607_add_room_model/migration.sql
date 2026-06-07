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
INSERT INTO "Room" (name, capacity, "isActive", "updatedAt")
SELECT DISTINCT
    COALESCE(NULLIF(TRIM("room"), ''), '默认房间') AS name,
    8 AS capacity,
    true AS "isActive",
    CURRENT_TIMESTAMP AS "updatedAt"
FROM "Session"
WHERE "roomId" IS NULL
ON CONFLICT (name) DO NOTHING;

UPDATE "Session" AS s
SET "roomId" = r.id
FROM "Room" AS r
WHERE s."roomId" IS NULL
  AND r.name = COALESCE(NULLIF(TRIM(s."room"), ''), '默认房间');

-- Step 3: Add foreign key constraint
ALTER TABLE "Session" ADD CONSTRAINT "Session_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Drop old room column
ALTER TABLE "Session" DROP COLUMN "room";

-- Step 5: Set roomId to NOT NULL
ALTER TABLE "Session" ALTER COLUMN "roomId" SET NOT NULL;
