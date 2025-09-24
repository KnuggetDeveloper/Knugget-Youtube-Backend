/*
  Warnings:

  - A unique constraint covering the columns `[subscriptionId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_subscriptionId_key" ON "users"("subscriptionId");
