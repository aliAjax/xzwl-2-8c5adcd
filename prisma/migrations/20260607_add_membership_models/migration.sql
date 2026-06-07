-- CreateEnum
CREATE TYPE "MembershipTransactionType" AS ENUM ('RECHARGE', 'CONSUME', 'REFUND');

-- CreateEnum
CREATE TYPE "MembershipTransactionStatus" AS ENUM ('SUCCESS', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "MembershipAccount" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipTransaction" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "type" "MembershipTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "status" "MembershipTransactionStatus" NOT NULL DEFAULT 'SUCCESS',
    "remark" TEXT,
    "operator" TEXT,
    "relatedBookingId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipAccount_customerId_key" ON "MembershipAccount"("customerId");

-- CreateIndex
CREATE INDEX "MembershipAccount_customerId_idx" ON "MembershipAccount"("customerId");

-- CreateIndex
CREATE INDEX "MembershipAccount_isActive_idx" ON "MembershipAccount"("isActive");

-- CreateIndex
CREATE INDEX "MembershipTransaction_accountId_idx" ON "MembershipTransaction"("accountId");

-- CreateIndex
CREATE INDEX "MembershipTransaction_type_idx" ON "MembershipTransaction"("type");

-- CreateIndex
CREATE INDEX "MembershipTransaction_status_idx" ON "MembershipTransaction"("status");

-- CreateIndex
CREATE INDEX "MembershipTransaction_relatedBookingId_idx" ON "MembershipTransaction"("relatedBookingId");

-- CreateIndex
CREATE INDEX "MembershipTransaction_createdAt_idx" ON "MembershipTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "MembershipAccount" ADD CONSTRAINT "MembershipAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MembershipAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_relatedBookingId_fkey" FOREIGN KEY ("relatedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
