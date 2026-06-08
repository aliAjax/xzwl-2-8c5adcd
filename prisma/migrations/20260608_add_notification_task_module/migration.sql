-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_START_REMINDER', 'SESSION_CANCELLED', 'WAITLIST_CONFIRMED', 'MEMBERSHIP_BALANCE_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'WECHAT');

-- CreateTable
CREATE TABLE "NotificationTask" (
    "id" SERIAL NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientName" TEXT,
    "templateCode" TEXT NOT NULL,
    "templateParams" JSONB NOT NULL,
    "content" TEXT,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "maxSendCount" INTEGER NOT NULL DEFAULT 3,
    "lastSendAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "retryAfter" TIMESTAMP(3),
    "relatedBookingId" INTEGER,
    "relatedSessionId" INTEGER,
    "relatedCustomerId" INTEGER,
    "relatedTransactionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTask_idempotencyKey_key" ON "NotificationTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationTask_type_idx" ON "NotificationTask"("type");

-- CreateIndex
CREATE INDEX "NotificationTask_status_idx" ON "NotificationTask"("status");

-- CreateIndex
CREATE INDEX "NotificationTask_recipientPhone_idx" ON "NotificationTask"("recipientPhone");

-- CreateIndex
CREATE INDEX "NotificationTask_relatedBookingId_idx" ON "NotificationTask"("relatedBookingId");

-- CreateIndex
CREATE INDEX "NotificationTask_relatedSessionId_idx" ON "NotificationTask"("relatedSessionId");

-- CreateIndex
CREATE INDEX "NotificationTask_relatedCustomerId_idx" ON "NotificationTask"("relatedCustomerId");

-- CreateIndex
CREATE INDEX "NotificationTask_createdAt_idx" ON "NotificationTask"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationTask_status_createdAt_idx" ON "NotificationTask"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_relatedBookingId_fkey" FOREIGN KEY ("relatedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_relatedSessionId_fkey" FOREIGN KEY ("relatedSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_relatedCustomerId_fkey" FOREIGN KEY ("relatedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_relatedTransactionId_fkey" FOREIGN KEY ("relatedTransactionId") REFERENCES "MembershipTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
