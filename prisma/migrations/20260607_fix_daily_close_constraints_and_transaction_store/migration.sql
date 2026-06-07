-- AlterTable
ALTER TABLE "MembershipTransaction" ADD COLUMN "storeId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "StoreDailyClose_normal_store_businessDate_key" ON "StoreDailyClose"("storeId", "businessDate") WHERE "status" = 'NORMAL';

-- CreateIndex
CREATE INDEX "MembershipTransaction_storeId_idx" ON "MembershipTransaction"("storeId");

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
