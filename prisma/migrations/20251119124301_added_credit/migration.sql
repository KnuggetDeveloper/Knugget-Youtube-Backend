/*
  Warnings:

  - The values [PREMIUM] on the enum `UserPlan` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `credits` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `supabaseId` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[firebaseUid]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserPlan_new" AS ENUM ('FREE', 'LITE', 'PRO');
ALTER TABLE "users" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "plan" TYPE "UserPlan_new" USING ("plan"::text::"UserPlan_new");
ALTER TYPE "UserPlan" RENAME TO "UserPlan_old";
ALTER TYPE "UserPlan_new" RENAME TO "UserPlan";
DROP TYPE "UserPlan_old";
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'FREE';
COMMIT;

-- DropIndex
DROP INDEX "users_supabaseId_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "credits",
DROP COLUMN "supabaseId",
ADD COLUMN     "firebaseUid" TEXT,
ADD COLUMN     "inputTokensRemaining" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outputTokensRemaining" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokenResetDate" TIMESTAMP(3),
ADD COLUMN     "videoResetDate" TIMESTAMP(3),
ADD COLUMN     "videosProcessedThisMonth" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "users_firebaseUid_key" ON "users"("firebaseUid");
