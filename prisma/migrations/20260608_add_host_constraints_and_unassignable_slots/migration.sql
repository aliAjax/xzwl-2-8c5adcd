-- AlterTable
ALTER TABLE "Host" ADD COLUMN "maxDailySessions" INTEGER;

-- CreateTable
CREATE TABLE "HostRestDay" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "restDate" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostRestDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleUnassignableSlot" (
    "id" SERIAL NOT NULL,
    "schedulePlanId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleUnassignableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostRestDay_hostId_restDate_key" ON "HostRestDay"("hostId", "restDate");

-- CreateIndex
CREATE INDEX "HostRestDay_hostId_idx" ON "HostRestDay"("hostId");

-- CreateIndex
CREATE INDEX "HostRestDay_restDate_idx" ON "HostRestDay"("restDate");

-- CreateIndex
CREATE INDEX "ScheduleUnassignableSlot_schedulePlanId_idx" ON "ScheduleUnassignableSlot"("schedulePlanId");

-- CreateIndex
CREATE INDEX "ScheduleUnassignableSlot_roomId_idx" ON "ScheduleUnassignableSlot"("roomId");

-- CreateIndex
CREATE INDEX "ScheduleUnassignableSlot_startTime_idx" ON "ScheduleUnassignableSlot"("startTime");

-- AddForeignKey
ALTER TABLE "HostRestDay" ADD CONSTRAINT "HostRestDay_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleUnassignableSlot" ADD CONSTRAINT "ScheduleUnassignableSlot_schedulePlanId_fkey" FOREIGN KEY ("schedulePlanId") REFERENCES "SchedulePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleUnassignableSlot" ADD CONSTRAINT "ScheduleUnassignableSlot_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
