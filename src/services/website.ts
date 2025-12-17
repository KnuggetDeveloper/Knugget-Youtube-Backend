import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  ServiceResponse,
  PaginatedResponse,
  WebsiteSummaryData,
  CreateWebsiteSummaryDto,
  WebsiteSummaryQueryParams,
  WebsiteSummaryStats,
} from "../types";

export class WebsiteSummaryService {
  // Create or get existing website article
  async createOrGetArticle(
    userId: string,
    data: CreateWebsiteSummaryDto
  ): Promise<ServiceResponse<WebsiteSummaryData>> {
    try {
      // Normalize URL for comparison
      const normalizedUrl = this.normalizeUrl(data.url);

      // Check if article already exists
      const existingArticle = await prisma.websiteSummary.findUnique({
        where: {
          userId_url: {
            userId,
            url: normalizedUrl,
          },
        },
      });

      if (existingArticle) {
        logger.info("Returning existing saved article", {
          userId,
          url: normalizedUrl,
        });
        return {
          success: true,
          data: this.formatArticle(existingArticle),
        };
      }

      // Calculate metadata
      const wordCount = data.textContent 
        ? data.textContent.split(/\s+/).length
        : data.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
      const readTime = Math.ceil(wordCount / 200); // Average reading speed: 200 words per minute

      // Extract website name and favicon (use provided or generate)
      const websiteName = data.websiteName || this.extractWebsiteName(data.url);
      const favicon = this.generateFaviconUrl(data.url);

      // Create article in database (NO AI processing, just save the Readability data)
      const article = await prisma.websiteSummary.create({
        data: {
          userId,
          url: normalizedUrl,
          title: data.title,
          content: data.content, // Clean HTML from Readability
          textContent: data.textContent || null, // Plain text from Readability
          excerpt: data.excerpt || null, // Short excerpt from Readability
          byline: data.byline || null, // Author from Readability
          websiteName,
          favicon,
          platform: "website",
          wordCount,
          readTime,
          language: data.language || null,
          direction: data.direction || null,
          publishedTime: data.publishedTime || null,
        },
      });

      logger.info("Website article saved successfully", {
        userId,
        articleId: article.id,
        url: normalizedUrl,
        wordCount,
      });

      return {
        success: true,
        data: this.formatArticle(article),
      };
    } catch (error) {
      logger.error("Failed to save website article", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url: data.url,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to save website article", 500);
    }
  }

  // Get user's saved articles with pagination
  async getArticles(
    userId: string,
    params: WebsiteSummaryQueryParams = {}
  ): Promise<ServiceResponse<PaginatedResponse<WebsiteSummaryData>>> {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        startDate,
        endDate,
        sortBy = "savedAt",
        sortOrder = "desc",
      } = params;

      // Build where clause
      const where: Prisma.WebsiteSummaryWhereInput = {
        userId,
        ...(startDate &&
          endDate && {
            savedAt: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { textContent: { contains: search, mode: "insensitive" } },
            { excerpt: { contains: search, mode: "insensitive" } },
            { websiteName: { contains: search, mode: "insensitive" } },
          ],
        }),
      };

      // Get total count
      const total = await prisma.websiteSummary.count({ where });

      // Get articles
      const articles = await prisma.websiteSummary.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      });

      const totalPages = Math.ceil(total / limit);

      const response: PaginatedResponse<WebsiteSummaryData> = {
        data: articles.map((a) => this.formatArticle(a)),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };

      return { success: true, data: response };
    } catch (error) {
      logger.error("Failed to get saved articles", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        params,
      });
      throw new AppError("Failed to get saved articles", 500);
    }
  }

  // Get article by ID
  async getArticleById(
    userId: string,
    articleId: string
  ): Promise<ServiceResponse<WebsiteSummaryData>> {
    try {
      const article = await prisma.websiteSummary.findFirst({
        where: {
          id: articleId,
          userId,
        },
      });

      if (!article) {
        throw new AppError("Article not found", 404);
      }

      return {
        success: true,
        data: this.formatArticle(article),
      };
    } catch (error) {
      logger.error("Failed to get article", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        articleId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get article", 500);
    }
  }

  // Get article by URL
  async getArticleByUrl(
    userId: string,
    url: string
  ): Promise<ServiceResponse<WebsiteSummaryData | null>> {
    try {
      const normalizedUrl = this.normalizeUrl(url);
      const article = await prisma.websiteSummary.findUnique({
        where: {
          userId_url: {
            userId,
            url: normalizedUrl,
          },
        },
      });

      return {
        success: true,
        data: article ? this.formatArticle(article) : null,
      };
    } catch (error) {
      logger.error("Failed to get article by URL", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url,
      });
      throw new AppError("Failed to get article", 500);
    }
  }

  // Delete a saved article
  async deleteArticle(
    userId: string,
    articleId: string
  ): Promise<ServiceResponse<void>> {
    try {
      const article = await prisma.websiteSummary.findFirst({
        where: {
          id: articleId,
          userId,
        },
      });

      if (!article) {
        throw new AppError("Article not found", 404);
      }

      await prisma.websiteSummary.delete({
        where: { id: articleId },
      });

      logger.info("Article deleted", {
        userId,
        articleId,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to delete article", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        articleId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to delete article", 500);
    }
  }

  // Get website article statistics
  async getStats(
    userId: string
  ): Promise<ServiceResponse<WebsiteSummaryStats>> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalArticles, articlesThisMonth, topWebsites, recentArticles] =
        await Promise.all([
          prisma.websiteSummary.count({
            where: { userId },
          }),
          prisma.websiteSummary.count({
            where: {
              userId,
              savedAt: { gte: startOfMonth },
            },
          }),
          prisma.websiteSummary.groupBy({
            by: ["websiteName"],
            where: { userId, websiteName: { not: null } },
            _count: { websiteName: true },
            orderBy: { _count: { websiteName: "desc" } },
            take: 5,
          }),
          prisma.websiteSummary.findMany({
            where: { userId },
            orderBy: { savedAt: "desc" },
            take: 5,
            select: {
              id: true,
              title: true,
              websiteName: true,
              savedAt: true,
            },
          }),
        ]);

      return {
        success: true,
        data: {
          totalArticles,
          articlesThisMonth,
          topWebsites: topWebsites.map((w) => ({
            website: w.websiteName || "Unknown",
            count: w._count.websiteName,
          })),
          recentArticles: recentArticles.map((a) => ({
            id: a.id,
            title: a.title,
            websiteName: a.websiteName || "Unknown",
            savedAt: a.savedAt.toISOString(),
          })),
        },
      };
    } catch (error) {
      logger.error("Failed to get article stats", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get article statistics", 500);
    }
  }

  // Format article for API response
  private formatArticle(article: any): WebsiteSummaryData {
    return {
      id: article.id,
      url: article.url,
      title: article.title,
      content: article.content,
      textContent: article.textContent,
      excerpt: article.excerpt,
      byline: article.byline,
      websiteName: article.websiteName,
      favicon: article.favicon,
      platform: article.platform,
      wordCount: article.wordCount,
      readTime: article.readTime,
      language: article.language,
      direction: article.direction,
      publishedTime: article.publishedTime,
      savedAt: article.savedAt,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  // Normalize URL for consistent comparison
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove trailing slash, fragment, and common tracking params
      let normalized = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }

  // Extract website name from URL
  private extractWebsiteName(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      // Remove www. prefix and get domain name
      const domain = hostname.replace(/^www\./, "");
      // Capitalize first letter
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch {
      return "Unknown";
    }
  }

  // Generate favicon URL
  private generateFaviconUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
    } catch {
      return "";
    }
  }
}

export const websiteSummaryService = new WebsiteSummaryService();
