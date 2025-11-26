import { prisma } from "../config/database";
import { logger } from "../config/logger";

interface TrackTokenUsageParams {
  userId: string;
  userEmail: string;
  videoId: string;
  videoUrl: string;
  videoTitle?: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  summaryId?: string;
  isSaved?: boolean;
  status?: "success" | "failed" | "partial";
  errorMessage?: string;
}

export class TokenUsageService {
  /**
   * Track token usage for every summary generation attempt
   * This runs regardless of whether the summary is saved
   */
  async trackTokenUsage(params: TrackTokenUsageParams): Promise<void> {
    try {
      const totalTokens = params.inputTokens + params.outputTokens;

      await prisma.tokenUsage.create({
        data: {
          userId: params.userId,
          userEmail: params.userEmail,
          videoId: params.videoId,
          videoUrl: params.videoUrl,
          videoTitle: params.videoTitle,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          totalTokens,
          model: params.model || "gpt-5-nano",
          operation: "summary_generation",
          summaryId: params.summaryId,
          isSaved: params.isSaved || false,
          status: params.status || "success",
          errorMessage: params.errorMessage,
        },
      });

      logger.info("✅ Token usage tracked", {
        userId: params.userId,
        videoId: params.videoId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens,
        isSaved: params.isSaved,
      });
    } catch (error) {
      logger.error("❌ Failed to track token usage", {
        error,
        userId: params.userId,
        videoId: params.videoId,
      });
      // Don't throw - tracking failure shouldn't break main operation
    }
  }

  /**
   * Update token usage when summary is saved
   */
  async markAsSaved(
    userId: string,
    videoId: string,
    summaryId: string
  ): Promise<void> {
    try {
      // Find the most recent token usage entry for this video
      const tokenUsage = await prisma.tokenUsage.findFirst({
        where: {
          userId,
          videoId,
          isSaved: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (tokenUsage) {
        await prisma.tokenUsage.update({
          where: { id: tokenUsage.id },
          data: {
            isSaved: true,
            summaryId,
          },
        });

        logger.info("✅ Token usage marked as saved", {
          tokenUsageId: tokenUsage.id,
          summaryId,
        });
      }
    } catch (error) {
      logger.error("❌ Failed to mark token usage as saved", {
        error,
        userId,
        videoId,
      });
    }
  }

  /**
   * Get token usage analytics for a user
   */
  async getUserTokenAnalytics(userId: string) {
    const stats = await prisma.tokenUsage.aggregate({
      where: { userId },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
      _count: {
        id: true,
      },
    });

    const savedCount = await prisma.tokenUsage.count({
      where: { userId, isSaved: true },
    });

    return {
      totalGenerations: stats._count.id,
      totalSaved: savedCount,
      totalUnsaved: stats._count.id - savedCount,
      totalInputTokens: stats._sum.inputTokens || 0,
      totalOutputTokens: stats._sum.outputTokens || 0,
      totalTokens: stats._sum.totalTokens || 0,
    };
  }

  /**
   * Get all token usage records for a user
   */
  async getUserTokenUsageHistory(userId: string, limit: number = 50) {
    return prisma.tokenUsage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Get token usage for a specific video
   */
  async getVideoTokenUsage(userId: string, videoId: string) {
    return prisma.tokenUsage.findMany({
      where: {
        userId,
        videoId,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const tokenUsageService = new TokenUsageService();
