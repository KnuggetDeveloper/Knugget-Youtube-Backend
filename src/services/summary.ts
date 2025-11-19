import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { openaiService } from "./openai";
import { tokenService } from "./token";
import {
  SummaryData,
  GenerateSummaryRequest,
  ServiceResponse,
  PaginatedResponse,
  SummaryQueryParams,
  CreateSummaryData,
  TranscriptSegment,
  VideoMetadata,
  MAX_SUMMARY_HISTORY,
} from "../types";

export class SummaryService {
  // Generate AI summary from transcript (without auto-saving)
  async generateSummary(
    userId: string,
    data: GenerateSummaryRequest
  ): Promise<ServiceResponse<SummaryData>> {
    try {
      // Check if user has enough videos and tokens for their plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          videosProcessedThisMonth: true,
          videoResetDate: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Get video limit based on plan
      let videoLimit: number;
      switch (user.plan) {
        case "FREE":
          videoLimit = config.videoLimits.free;
          break;
        case "LITE":
          videoLimit = config.videoLimits.lite;
          break;
        case "PRO":
          videoLimit = config.videoLimits.pro;
          break;
        default:
          videoLimit = config.videoLimits.free;
      }

      // Check video limit
      if (user.videosProcessedThisMonth >= videoLimit) {
        throw new AppError(
          `Video limit reached. You have processed ${user.videosProcessedThisMonth}/${videoLimit} videos this month. Upgrade your plan for more videos!`,
          402
        );
      }

      // Check token availability (ALL users now use tokens)
      const transcriptText = this.formatTranscriptText(data.transcript);
      const estimatedUsage = tokenService.estimateTokenUsage(transcriptText);

      const tokenStatus = await tokenService.checkTokenAvailability(
        userId,
        estimatedUsage.inputTokens,
        estimatedUsage.outputTokens
      );

      if (!tokenStatus.success) {
        throw new AppError("Failed to check token availability", 500);
      }

      if (tokenStatus.data?.isTokensExhausted) {
        throw new AppError(
          "Token limit exceeded. Your tokens will reset on your next billing date.",
          402
        );
      }

      if (!tokenStatus.data?.hasEnoughTokens) {
        throw new AppError(
          `Insufficient tokens. Required: ${estimatedUsage.inputTokens} input, ${estimatedUsage.outputTokens} output. Available: ${tokenStatus.data?.inputTokensRemaining} input, ${tokenStatus.data?.outputTokensRemaining} output.`,
          402
        );
      }

      // Check if summary already exists for this video
      const existingSummary = await prisma.summary.findFirst({
        where: {
          userId,
          videoId: data.videoMetadata.videoId,
          status: "COMPLETED",
        },
      });

      if (existingSummary) {
        return {
          success: true,
          data: this.formatSummary(existingSummary),
        };
      }

      // Generate summary using OpenAI without saving to database
      const aiResult = await openaiService.generateSummary(
        data.transcript,
        data.videoMetadata,
        userId
      );

      if (!aiResult.success || !aiResult.data) {
        throw new AppError(
          aiResult.error || "AI summary generation failed",
          500
        );
      }

      // Return generated summary data without saving to database
      const summaryData: SummaryData = {
        id: "", // Empty ID indicates this hasn't been saved yet
        title: data.videoMetadata.title,
        keyPoints: aiResult.data.keyPoints,
        fullSummary: aiResult.data.fullSummary,
        tags: aiResult.data.tags,
        status: "COMPLETED",
        videoId: data.videoMetadata.videoId,
        videoTitle: data.videoMetadata.title,
        channelName: data.videoMetadata.channelName,
        videoDuration: data.videoMetadata.duration,
        videoUrl: data.videoMetadata.url,
        thumbnailUrl: data.videoMetadata.thumbnailUrl,
        transcript: data.transcript as any,
        transcriptText: this.formatTranscriptText(data.transcript),
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        isUnsaved: true, // Flag to indicate this summary hasn't been saved
      };

      logger.info("Summary generated successfully (not saved)", {
        userId,
        videoId: data.videoMetadata.videoId,
        keyPointsCount: aiResult.data.keyPoints.length,
        tagsCount: aiResult.data.tags.length,
      });

      return {
        success: true,
        data: summaryData,
      };
    } catch (error) {
      logger.error("Summary generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        videoId: data.videoMetadata.videoId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Summary generation failed", 500);
    }
  }

  // Save/update summary
  async saveSummary(
    userId: string,
    summaryData: Partial<CreateSummaryData> & { id?: string }
  ): Promise<ServiceResponse<SummaryData>> {
    try {
      let summary;
      let shouldIncrementVideo = false;

      if (summaryData.id && summaryData.id !== "") {
        // Update existing summary
        summary = await prisma.summary.findFirst({
          where: {
            id: summaryData.id,
            userId,
          },
        });

        if (!summary) {
          throw new AppError("Summary not found", 404);
        }

        summary = await prisma.summary.update({
          where: { id: summaryData.id },
          data: {
            title: summaryData.title ?? summary.title,
            keyPoints: summaryData.keyPoints ?? summary.keyPoints,
            fullSummary: summaryData.fullSummary ?? summary.fullSummary,
            tags: summaryData.tags ?? summary.tags,
          },
        });
      } else {
        // Create new summary - this is when we increment video count
        if (
          !summaryData.videoId ||
          !summaryData.videoTitle ||
          !summaryData.channelName
        ) {
          throw new AppError("Missing required video metadata", 400);
        }

        // Check if user has video quota remaining
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            plan: true,
            videosProcessedThisMonth: true,
          },
        });

        if (!user) {
          throw new AppError("User not found", 404);
        }

        // Get video limit based on plan
        let videoLimit: number;
        switch (user.plan) {
          case "FREE":
            videoLimit = config.videoLimits.free;
            break;
          case "LITE":
            videoLimit = config.videoLimits.lite;
            break;
          case "PRO":
            videoLimit = config.videoLimits.pro;
            break;
          default:
            videoLimit = config.videoLimits.free;
        }

        if (user.videosProcessedThisMonth >= videoLimit) {
          throw new AppError(
            `Video limit reached. You have processed ${user.videosProcessedThisMonth}/${videoLimit} videos this month.`,
            402
          );
        }

        shouldIncrementVideo = true;

        // Check if summary already exists for this video
        const existingSummary = await prisma.summary.findFirst({
          where: {
            userId,
            videoId: summaryData.videoId,
            status: "COMPLETED",
          },
        });

        if (existingSummary) {
          // Return existing summary without deducting credits
          return {
            success: true,
            data: this.formatSummary(existingSummary),
          };
        }

        summary = await prisma.summary.create({
          data: {
            title: summaryData.title || summaryData.videoTitle,
            keyPoints: summaryData.keyPoints || [],
            fullSummary: summaryData.fullSummary || "",
            tags: summaryData.tags || [],
            status: "COMPLETED",
            videoId: summaryData.videoId,
            videoTitle: summaryData.videoTitle,
            channelName: summaryData.channelName,
            videoDuration: summaryData.videoDuration,
            videoUrl:
              summaryData.videoUrl ||
              `https://youtube.com/watch?v=${summaryData.videoId}`,
            thumbnailUrl: summaryData.thumbnailUrl,
            transcript: summaryData.transcript,
            transcriptText: summaryData.transcriptText,
            userId,
          },
        });

        // Increment video count after successful save
        if (shouldIncrementVideo) {
          await prisma.user.update({
            where: { id: userId },
            data: { videosProcessedThisMonth: { increment: 1 } },
          });
        }
      }

      logger.info("Summary saved successfully", {
        userId,
        summaryId: summary.id,
        videoId: summary.videoId,
      });

      return {
        success: true,
        data: this.formatSummary(summary),
      };
    } catch (error) {
      logger.error("Summary save failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId: summaryData.id,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to save summary", 500);
    }
  }

  // Get user's summaries with pagination and filtering
  async getSummaries(
    userId: string,
    params: SummaryQueryParams = {}
  ): Promise<ServiceResponse<PaginatedResponse<SummaryData>>> {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        status,
        videoId,
        startDate,
        endDate,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = params;

      // Build where clause
      const where: Prisma.SummaryWhereInput = {
        userId,
        ...(status && { status }),
        ...(videoId && { videoId }),
        ...(startDate &&
          endDate && {
            createdAt: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { videoTitle: { contains: search, mode: "insensitive" } },
            { channelName: { contains: search, mode: "insensitive" } },
            { fullSummary: { contains: search, mode: "insensitive" } },
          ],
        }),
      };

      // Get total count
      const total = await prisma.summary.count({ where });

      // Get summaries
      const summaries = await prisma.summary.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      });

      const totalPages = Math.ceil(total / limit);

      const response: PaginatedResponse<SummaryData> = {
        data: summaries.map((summary) => this.formatSummary(summary)),
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
      logger.error("Get summaries failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        params,
      });
      throw new AppError("Failed to get summaries", 500);
    }
  }

  // Get single summary by ID
  async getSummaryById(
    userId: string,
    summaryId: string
  ): Promise<ServiceResponse<SummaryData>> {
    try {
      const summary = await prisma.summary.findFirst({
        where: {
          id: summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Summary not found", 404);
      }

      return {
        success: true,
        data: this.formatSummary(summary),
      };
    } catch (error) {
      logger.error("Get summary by ID failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get summary", 500);
    }
  }

  // Update summary
  async updateSummary(
    userId: string,
    summaryId: string,
    updates: Partial<
      Pick<SummaryData, "title" | "keyPoints" | "fullSummary" | "tags">
    >
  ): Promise<ServiceResponse<SummaryData>> {
    try {
      const existingSummary = await prisma.summary.findFirst({
        where: {
          id: summaryId,
          userId,
        },
      });

      if (!existingSummary) {
        throw new AppError("Summary not found", 404);
      }

      const updatedSummary = await prisma.summary.update({
        where: { id: summaryId },
        data: updates,
      });

      logger.info("Summary updated successfully", {
        userId,
        summaryId,
        updates: Object.keys(updates),
      });

      return {
        success: true,
        data: this.formatSummary(updatedSummary),
      };
    } catch (error) {
      logger.error("Summary update failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to update summary", 500);
    }
  }

  // Delete summary
  async deleteSummary(
    userId: string,
    summaryId: string
  ): Promise<ServiceResponse<void>> {
    try {
      const summary = await prisma.summary.findFirst({
        where: {
          id: summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Summary not found", 404);
      }

      await prisma.summary.delete({
        where: { id: summaryId },
      });

      logger.info("Summary deleted successfully", {
        userId,
        summaryId,
        videoId: summary.videoId,
      });

      return { success: true };
    } catch (error) {
      logger.error("Summary deletion failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to delete summary", 500);
    }
  }

  // Get summary by video ID (check if summary exists)
  async getSummaryByVideoId(
    userId: string,
    videoId: string
  ): Promise<ServiceResponse<SummaryData | null>> {
    try {
      const summary = await prisma.summary.findFirst({
        where: {
          userId,
          videoId,
          status: "COMPLETED",
        },
        orderBy: { createdAt: "desc" },
      });

      return {
        success: true,
        data: summary ? this.formatSummary(summary) : null,
      };
    } catch (error) {
      logger.error("Get summary by video ID failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        videoId,
      });
      throw new AppError("Failed to get summary", 500);
    }
  }

  // Clean up old summaries (keep only recent ones per user)
  async cleanupOldSummaries(): Promise<void> {
    try {
      // Get users with more than MAX_SUMMARY_HISTORY summaries
      const usersWithManySummaries = await prisma.user.findMany({
        where: {
          summaries: {
            some: {},
          },
        },
        select: {
          id: true,
          _count: {
            select: { summaries: true },
          },
        },
      });

      for (const user of usersWithManySummaries) {
        if (user._count.summaries > MAX_SUMMARY_HISTORY) {
          // Get oldest summaries to delete
          const summariesToDelete = await prisma.summary.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
            take: user._count.summaries - MAX_SUMMARY_HISTORY,
            select: { id: true },
          });

          if (summariesToDelete.length > 0) {
            await prisma.summary.deleteMany({
              where: {
                id: { in: summariesToDelete.map((s) => s.id) },
              },
            });

            logger.info("Old summaries cleaned up", {
              userId: user.id,
              deletedCount: summariesToDelete.length,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Summary cleanup failed", { error });
    }
  }

  // Format summary for API response
  private formatSummary(summary: any): SummaryData {
    return {
      id: summary.id,
      title: summary.title,
      keyPoints: summary.keyPoints,
      fullSummary: summary.fullSummary,
      tags: summary.tags,
      status: summary.status,
      videoId: summary.videoId,
      videoTitle: summary.videoTitle,
      channelName: summary.channelName,
      videoDuration: summary.videoDuration,
      videoUrl: summary.videoUrl,
      thumbnailUrl: summary.thumbnailUrl,
      transcript: summary.transcript as TranscriptSegment[],
      transcriptText: summary.transcriptText,
      userId: summary.userId,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    };
  }

  // Format transcript segments to plain text
  private formatTranscriptText(transcript: TranscriptSegment[]): string {
    return transcript.map((segment) => segment.text).join(" ");
  }

  // Get summary statistics for a user
  async getSummaryStats(userId: string): Promise<
    ServiceResponse<{
      totalSummaries: number;
      summariesThisMonth: number;
      completedSummaries: number;
      failedSummaries: number;
      averageSummaryLength: number;
    }>
  > {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalSummaries,
        summariesThisMonth,
        completedSummaries,
        failedSummaries,
        completedSummariesForAvg,
      ] = await Promise.all([
        prisma.summary.count({
          where: { userId },
        }),
        prisma.summary.count({
          where: {
            userId,
            createdAt: { gte: startOfMonth },
          },
        }),
        prisma.summary.count({
          where: {
            userId,
            status: "COMPLETED",
          },
        }),
        prisma.summary.count({
          where: {
            userId,
            status: "FAILED",
          },
        }),
        prisma.summary.findMany({
          where: {
            userId,
            status: "COMPLETED",
          },
          select: {
            fullSummary: true,
          },
        }),
      ]);

      const averageSummaryLength =
        completedSummariesForAvg.length > 0
          ? Math.round(
              completedSummariesForAvg.reduce(
                (sum, s) => sum + s.fullSummary.length,
                0
              ) / completedSummariesForAvg.length
            )
          : 0;

      return {
        success: true,
        data: {
          totalSummaries,
          summariesThisMonth,
          completedSummaries,
          failedSummaries,
          averageSummaryLength,
        },
      };
    } catch (error) {
      logger.error("Get summary stats failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get summary statistics", 500);
    }
  }
}

export const summaryService = new SummaryService();
