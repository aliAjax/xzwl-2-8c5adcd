-- CreateEnum
CREATE TYPE "SchedulePlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "businessStartTime" VARCHAR(5) NOT NULL DEFAULT '10:00',
ADD COLUMN "businessEndTime" VARCHAR(5) NOT NULL DEFAULT '23:00';

-- CreateTable
CREATE TABLE "SchedulePlan" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "SchedulePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDraftSession" (
    "id" SERIAL NOT NULL,
    "schedulePlanId" INTEGER NOT NULL,
    "scriptId" INTEGER NOT NULL,
    "hostId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "remark" TEXT,
    "conflictInfo" TEXT,
    "proficiencyLevel" "ProficiencyLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleDraftSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulePlan_storeId_idx" ON "SchedulePlan"("storeId");

-- CreateIndex
CREATE INDEX "SchedulePlan_status_idx" ON "SchedulePlan"("status");

-- CreateIndex
CREATE INDEX "SchedulePlan_startDate_endDate_idx" ON "SchedulePlan"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "ScheduleDraftSession_schedulePlanId_idx" ON "ScheduleDraftSession"("schedulePlanId");

-- CreateIndex
CREATE INDEX "ScheduleDraftSession_scriptId_idx" ON "ScheduleDraftSession"("scriptId");

-- CreateIndex
CREATE INDEX "ScheduleDraftSession_hostId_idx" ON "ScheduleDraftSession"("hostId");

-- CreateIndex
CREATE INDEX "ScheduleDraftSession_roomId_idx" ON "ScheduleDraftSession"("roomId");

-- AddForeignKey
ALTER TABLE "SchedulePlan" ADD CONSTRAINT "SchedulePlan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDraftSession" ADD CONSTRAINT "ScheduleDraftSession_schedulePlanId_fkey" FOREIGN KEY ("schedulePlanId") REFERENCES "SchedulePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDraftSession" ADD CONSTRAINT "ScheduleDraftSession_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDraftSession" ADD CONSTRAINT "ScheduleDraftSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDraftSession" ADD CONSTRAINT "ScheduleDraftSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
