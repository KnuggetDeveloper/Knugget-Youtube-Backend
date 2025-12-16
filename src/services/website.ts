import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { openaiService } from "./openai";
import { tokenService } from "./token";
import {
  ServiceResponse,
  PaginatedResponse,
  WebsiteSummaryData,
  CreateWebsiteSummaryDto,
  WebsiteSummaryQueryParams,
  WebsiteSummaryStats,
} from "../types";

export class WebsiteSummaryService {
  // Create or get existing website summary
  async createOrGetSummary(
    userId: string,
    data: CreateWebsiteSummaryDto
  ): Promise<ServiceResponse<WebsiteSummaryData>> {
    try {
      // Normalize URL for comparison
      const normalizedUrl = this.normalizeUrl(data.url);

      // Check if summary already exists
      const existingSummary = await prisma.websiteSummary.findUnique({
        where: {
          userId_url: {
            userId,
            url: normalizedUrl,
          },
        },
      });

      if (existingSummary) {
        logger.info("Returning existing website summary", {
          userId,
          url: normalizedUrl,
        });
        return {
          success: true,
          data: this.formatSummary(existingSummary),
        };
      }

      // Check token availability
      const estimatedTokens = Math.ceil(data.content.length / 4); // rough estimate
      const tokenStatus = await tokenService.checkTokenAvailability(
        userId,
        estimatedTokens,
        500 // estimated output tokens
      );

      if (!tokenStatus.success || !tokenStatus.data?.hasEnoughTokens) {
        throw new AppError(
          "Insufficient tokens for summarization. Please upgrade your plan.",
          402
        );
      }

      // Generate summary using OpenAI
      const summaryResult = await this.generateSummary(data.content, data.title);

      if (!summaryResult.success || !summaryResult.data) {
        throw new AppError(
          summaryResult.error || "Failed to generate summary",
          500
        );
      }

      // Calculate metadata
      const wordCount = data.content.split(/\s+/).length;
      const readTime = Math.ceil(wordCount / 200); // Average reading speed

      // Extract website name and favicon
      const websiteName = this.extractWebsiteName(data.url);
      const favicon = this.generateFaviconUrl(data.url);

      // Create summary in database
      const summary = await prisma.websiteSummary.create({
        data: {
          userId,
          url: normalizedUrl,
          title: data.title,
          content: data.content.substring(0, 50000), // Limit stored content
          summary: summaryResult.data.summary,
          keyPoints: summaryResult.data.keyPoints,
          tags: summaryResult.data.tags,
          websiteName,
          favicon,
          wordCount,
          readTime,
          author: data.author,
          publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
          status: "COMPLETED",
        },
      });

      logger.info("Website summary created successfully", {
        userId,
        summaryId: summary.id,
        url: normalizedUrl,
      });

      return {
        success: true,
        data: this.formatSummary(summary),
      };
    } catch (error) {
      logger.error("Failed to create website summary", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url: data.url,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to create website summary", 500);
    }
  }

  // Get user's website summaries with pagination
  async getSummaries(
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
            { summary: { contains: search, mode: "insensitive" } },
            { websiteName: { contains: search, mode: "insensitive" } },
          ],
        }),
      };

      // Get total count
      const total = await prisma.websiteSummary.count({ where });

      // Get summaries
      const summaries = await prisma.websiteSummary.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      });

      const totalPages = Math.ceil(total / limit);

      const response: PaginatedResponse<WebsiteSummaryData> = {
        data: summaries.map((s) => this.formatSummary(s)),
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
      logger.error("Failed to get website summaries", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        params,
      });
      throw new AppError("Failed to get website summaries", 500);
    }
  }

  // Get summary by ID
  async getSummaryById(
    userId: string,
    summaryId: string
  ): Promise<ServiceResponse<WebsiteSummaryData>> {
    try {
      const summary = await prisma.websiteSummary.findFirst({
        where: {
          id: summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Website summary not found", 404);
      }

      return {
        success: true,
        data: this.formatSummary(summary),
      };
    } catch (error) {
      logger.error("Failed to get website summary", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get website summary", 500);
    }
  }

  // Get summary by URL
  async getSummaryByUrl(
    userId: string,
    url: string
  ): Promise<ServiceResponse<WebsiteSummaryData | null>> {
    try {
      const normalizedUrl = this.normalizeUrl(url);
      const summary = await prisma.websiteSummary.findUnique({
        where: {
          userId_url: {
            userId,
            url: normalizedUrl,
          },
        },
      });

      return {
        success: true,
        data: summary ? this.formatSummary(summary) : null,
      };
    } catch (error) {
      logger.error("Failed to get website summary by URL", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url,
      });
      throw new AppError("Failed to get website summary", 500);
    }
  }

  // Delete a website summary
  async deleteSummary(
    userId: string,
    summaryId: string
  ): Promise<ServiceResponse<void>> {
    try {
      const summary = await prisma.websiteSummary.findFirst({
        where: {
          id: summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Website summary not found", 404);
      }

      await prisma.websiteSummary.delete({
        where: { id: summaryId },
      });

      logger.info("Website summary deleted", {
        userId,
        summaryId,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to delete website summary", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to delete website summary", 500);
    }
  }

  // Get website summary statistics
  async getStats(
    userId: string
  ): Promise<ServiceResponse<WebsiteSummaryStats>> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalSummaries, summariesThisMonth, topWebsites, recentSummaries] =
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
          totalSummaries,
          summariesThisMonth,
          topWebsites: topWebsites.map((w) => ({
            website: w.websiteName || "Unknown",
            count: w._count.websiteName,
          })),
          recentSummaries: recentSummaries.map((s) => ({
            id: s.id,
            title: s.title,
            websiteName: s.websiteName || "Unknown",
            savedAt: s.savedAt.toISOString(),
          })),
        },
      };
    } catch (error) {
      logger.error("Failed to get website summary stats", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get website summary statistics", 500);
    }
  }

  // Generate summary using OpenAI
  private async generateSummary(
    content: string,
    title: string
  ): Promise<
    ServiceResponse<{ summary: string; keyPoints: string[]; tags: string[] }>
  > {
    try {
      const systemPrompt = `You are an expert article summarizer. Your task is to analyze articles and provide concise, accurate summaries with key points and tags. Always respond in valid JSON format.`;
      
      const userPrompt = `Summarize the following article titled "${title}". 
      
Article content:
${content.substring(0, 15000)}

Please provide:
1. A comprehensive summary (2-3 paragraphs)
2. 5-7 key points as bullet points
3. 3-5 relevant tags

Format your response as JSON:
{
  "summary": "...",
  "keyPoints": ["point1", "point2", ...],
  "tags": ["tag1", "tag2", ...]
}`;

      const response = await openaiService.generateCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 2000,
        temperature: 0.5,
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to generate summary");
      }

      const parsed = JSON.parse(response.data.content);

      return {
        success: true,
        data: {
          summary: parsed.summary || "",
          keyPoints: parsed.keyPoints || [],
          tags: parsed.tags || [],
        },
      };
    } catch (error) {
      logger.error("Failed to generate summary with OpenAI", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return {
        success: false,
        error: "Failed to generate summary",
      };
    }
  }

  // Format summary for API response
  private formatSummary(summary: any): WebsiteSummaryData {
    return {
      id: summary.id,
      url: summary.url,
      title: summary.title,
      content: summary.content,
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      tags: summary.tags,
      websiteName: summary.websiteName,
      favicon: summary.favicon,
      wordCount: summary.wordCount,
      readTime: summary.readTime,
      author: summary.author,
      publishedAt: summary.publishedAt,
      status: summary.status,
      savedAt: summary.savedAt,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
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

