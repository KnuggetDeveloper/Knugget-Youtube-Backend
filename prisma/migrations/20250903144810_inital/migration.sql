-- CreateTable
CREATE TABLE "website_summaries" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "websiteName" TEXT NOT NULL,
    "faviconUrl" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "linkedinPostId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'linkedin',
    "engagement" JSONB,
    "metadata" JSONB,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_summaries_userId_idx" ON "website_summaries"("userId");

-- CreateIndex
CREATE INDEX "website_summaries_url_idx" ON "website_summaries"("url");

-- CreateIndex
CREATE UNIQUE INDEX "website_summaries_userId_url_key" ON "website_summaries"("userId", "url");

-- CreateIndex
CREATE INDEX "linkedin_posts_userId_idx" ON "linkedin_posts"("userId");

-- CreateIndex
CREATE INDEX "linkedin_posts_savedAt_idx" ON "linkedin_posts"("savedAt");

-- CreateIndex
CREATE INDEX "linkedin_posts_platform_idx" ON "linkedin_posts"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_posts_userId_postUrl_key" ON "linkedin_posts"("userId", "postUrl");

-- AddForeignKey
ALTER TABLE "website_summaries" ADD CONSTRAINT "website_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_posts" ADD CONSTRAINT "linkedin_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
