-- CreateEnum
CREATE TYPE "StoreDailyCloseStatus" AS ENUM ('NORMAL', 'VOIDED');

-- CreateTable
CREATE TABLE "StoreDailyClose" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "status" "StoreDailyCloseStatus" NOT NULL DEFAULT 'NORMAL',
    "completedSessionCount" INTEGER NOT NULL DEFAULT 0,
    "totalBookingCount" INTEGER NOT NULL DEFAULT 0,
    "totalPlayerCount" INTEGER NOT NULL DEFAULT 0,
    "receivableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "membershipConsume" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "membershipRecharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discrepancyAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "operator" TEXT,
    "originalCloseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreDailyClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDailyCloseSession" (
    "id" SERIAL NOT NULL,
    "dailyCloseId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "scriptName" TEXT NOT NULL,
    "hostName" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "playerCount" INTEGER NOT NULL DEFAULT 0,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "sessionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreDailyCloseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDailyCloseBooking" (
    "id" SERIAL NOT NULL,
    "dailyCloseId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "sessionPrice" DECIMAL(10,2) NOT NULL,
    "bookingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "useMembership" BOOLEAN NOT NULL DEFAULT false,
    "membershipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreDailyCloseBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDailyCloseTransaction" (
    "id" SERIAL NOT NULL,
    "dailyCloseId" INTEGER NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "type" "MembershipTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "status" "MembershipTransactionStatus" NOT NULL,
    "remark" TEXT,
    "operator" TEXT,
    "relatedBookingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionCreatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreDailyCloseTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreDailyClose_storeId_businessDate_status_key" ON "StoreDailyClose"("storeId", "businessDate", "status");

-- CreateIndex
CREATE INDEX "StoreDailyClose_storeId_idx" ON "StoreDailyClose"("storeId");

-- CreateIndex
CREATE INDEX "StoreDailyClose_businessDate_idx" ON "StoreDailyClose"("businessDate");

-- CreateIndex
CREATE INDEX "StoreDailyClose_status_idx" ON "StoreDailyClose"("status");

-- CreateIndex
CREATE INDEX "StoreDailyClose_storeId_businessDate_idx" ON "StoreDailyClose"("storeId", "businessDate");

-- CreateIndex
CREATE INDEX "StoreDailyCloseSession_dailyCloseId_idx" ON "StoreDailyCloseSession"("dailyCloseId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseSession_sessionId_idx" ON "StoreDailyCloseSession"("sessionId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseBooking_dailyCloseId_idx" ON "StoreDailyCloseBooking"("dailyCloseId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseBooking_bookingId_idx" ON "StoreDailyCloseBooking"("bookingId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseBooking_sessionId_idx" ON "StoreDailyCloseBooking"("sessionId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseTransaction_dailyCloseId_idx" ON "StoreDailyCloseTransaction"("dailyCloseId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseTransaction_transactionId_idx" ON "StoreDailyCloseTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "StoreDailyCloseTransaction_type_idx" ON "StoreDailyCloseTransaction"("type");

-- AddForeignKey
ALTER TABLE "StoreDailyClose" ADD CONSTRAINT "StoreDailyClose_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreDailyClose" ADD CONSTRAINT "StoreDailyClose_originalCloseId_fkey" FOREIGN KEY ("originalCloseId") REFERENCES "StoreDailyClose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreDailyCloseSession" ADD CONSTRAINT "StoreDailyCloseSession_dailyCloseId_fkey" FOREIGN KEY ("dailyCloseId") REFERENCES "StoreDailyClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreDailyCloseBooking" ADD CONSTRAINT "StoreDailyCloseBooking_dailyCloseId_fkey" FOREIGN KEY ("dailyCloseId") REFERENCES "StoreDailyClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreDailyCloseTransaction" ADD CONSTRAINT "StoreDailyCloseTransaction_dailyCloseId_fkey" FOREIGN KEY ("dailyCloseId") REFERENCES "StoreDailyClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;
