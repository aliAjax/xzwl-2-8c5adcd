-- CreateEnum
CREATE TYPE "NotificationTaskType" AS ENUM ('SESSION_OPENING_REMINDER', 'SESSION_CANCELLATION', 'WAITLIST_CONFIRMATION', 'BALANCE_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'WECHAT', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationTaskStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "NotificationTask" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER,
    "type" "NotificationTaskType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
    "templateCode" TEXT NOT NULL,
    "templateParams" JSONB NOT NULL,
    "recipientSnapshot" JSONB NOT NULL,
    "content" TEXT,
    "status" "NotificationTaskStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "businessType" TEXT,
    "businessId" INTEGER,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTask_idempotencyKey_key" ON "NotificationTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationTask_type_idx" ON "NotificationTask"("type");

-- CreateIndex
CREATE INDEX "NotificationTask_status_idx" ON "NotificationTask"("status");

-- CreateIndex
CREATE INDEX "NotificationTask_channel_idx" ON "NotificationTask"("channel");

-- CreateIndex
CREATE INDEX "NotificationTask_businessType_businessId_idx" ON "NotificationTask"("businessType", "businessId");

-- CreateIndex
CREATE INDEX "NotificationTask_scheduledAt_idx" ON "NotificationTask"("scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationTask_createdAt_idx" ON "NotificationTask"("createdAt");

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
