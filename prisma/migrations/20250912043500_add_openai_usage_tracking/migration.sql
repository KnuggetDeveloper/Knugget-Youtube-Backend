-- CreateTable
CREATE TABLE "openai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "videoId" TEXT,
    "summaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "openai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openai_usage_userId_idx" ON "openai_usage"("userId");

-- CreateIndex
CREATE INDEX "openai_usage_createdAt_idx" ON "openai_usage"("createdAt");

-- CreateIndex
CREATE INDEX "openai_usage_operation_idx" ON "openai_usage"("operation");

-- AddForeignKey
ALTER TABLE "openai_usage" ADD CONSTRAINT "openai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
