-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cancelAtBillingDate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextBillingDate" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT DEFAULT 'free';
