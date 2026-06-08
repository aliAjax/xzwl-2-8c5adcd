-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_START_REMINDER', 'SESSION_CANCELLED', 'WAITLIST_CONFIRMED', 'MEMBERSHIP_BALANCE_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING', 'CANCELLED');

-- Replace the first notification migration's broader channel enum.
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'WECHAT');

-- Drop old indexes and relation before reshaping the table.
ALTER TABLE "NotificationTask" DROP CONSTRAINT IF EXISTS "NotificationTask_storeId_fkey";
DROP INDEX IF EXISTS "NotificationTask_idempotencyKey_key";
DROP INDEX IF EXISTS "NotificationTask_type_idx";
DROP INDEX IF EXISTS "NotificationTask_status_idx";
DROP INDEX IF EXISTS "NotificationTask_channel_idx";
DROP INDEX IF EXISTS "NotificationTask_businessType_businessId_idx";
DROP INDEX IF EXISTS "NotificationTask_scheduledAt_idx";
DROP INDEX IF EXISTS "NotificationTask_createdAt_idx";

-- Rename retry/failure fields to match the Prisma model.
ALTER TABLE "NotificationTask" RENAME COLUMN "failureReason" TO "failedReason";
ALTER TABLE "NotificationTask" RENAME COLUMN "retryCount" TO "sendCount";
ALTER TABLE "NotificationTask" RENAME COLUMN "maxRetries" TO "maxSendCount";

-- Add fields used by the final notification task model.
ALTER TABLE "NotificationTask" ADD COLUMN "recipientPhone" TEXT;
ALTER TABLE "NotificationTask" ADD COLUMN "recipientName" TEXT;
ALTER TABLE "NotificationTask" ADD COLUMN "lastSendAt" TIMESTAMP(3);
ALTER TABLE "NotificationTask" ADD COLUMN "retryAfter" TIMESTAMP(3);
ALTER TABLE "NotificationTask" ADD COLUMN "relatedBookingId" INTEGER;
ALTER TABLE "NotificationTask" ADD COLUMN "relatedSessionId" INTEGER;
ALTER TABLE "NotificationTask" ADD COLUMN "relatedCustomerId" INTEGER;
ALTER TABLE "NotificationTask" ADD COLUMN "relatedTransactionId" INTEGER;

-- Preserve recipient snapshots from the first version of the table.
UPDATE "NotificationTask"
SET
  "recipientPhone" = COALESCE("recipientSnapshot"->>'phone', ''),
  "recipientName" = "recipientSnapshot"->>'name";

ALTER TABLE "NotificationTask" ALTER COLUMN "recipientPhone" SET NOT NULL;

-- Convert old notification type/status/channel values to the final enums.
ALTER TABLE "NotificationTask"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING (
    CASE "type"::text
      WHEN 'SESSION_OPENING_REMINDER' THEN 'SESSION_START_REMINDER'
      WHEN 'SESSION_CANCELLATION' THEN 'SESSION_CANCELLED'
      WHEN 'WAITLIST_CONFIRMATION' THEN 'WAITLIST_CONFIRMED'
      WHEN 'BALANCE_CHANGE' THEN 'MEMBERSHIP_BALANCE_CHANGE'
    END
  )::"NotificationType";

ALTER TABLE "NotificationTask" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NotificationTask"
  ALTER COLUMN "status" TYPE "NotificationStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'SENDING' THEN 'RETRYING'
      WHEN 'SENT' THEN 'SENT'
      WHEN 'FAILED' THEN 'FAILED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
    END
  )::"NotificationStatus";
ALTER TABLE "NotificationTask" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "NotificationTask" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "NotificationTask"
  ALTER COLUMN "channel" TYPE "NotificationChannel"
  USING (
    CASE "channel"::text
      WHEN 'PUSH' THEN 'SMS'
      ELSE "channel"::text
    END
  )::"NotificationChannel";
ALTER TABLE "NotificationTask" ALTER COLUMN "channel" SET DEFAULT 'SMS';

-- Remove fields from the first table shape.
ALTER TABLE "NotificationTask" DROP COLUMN "storeId";
ALTER TABLE "NotificationTask" DROP COLUMN "recipientSnapshot";
ALTER TABLE "NotificationTask" DROP COLUMN "businessType";
ALTER TABLE "NotificationTask" DROP COLUMN "businessId";
ALTER TABLE "NotificationTask" DROP COLUMN "scheduledAt";

DROP TYPE "NotificationTaskType";
DROP TYPE "NotificationTaskStatus";
DROP TYPE "NotificationChannel_old";

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
