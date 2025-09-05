import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { openaiService } from "./openai";
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
  // Generate AI summary from transcript
  async generateSummary(
    userId: string,
    data: GenerateSummaryRequest
  ): Promise<ServiceResponse<SummaryData>> {
    try {
      // Check if user has enough credits
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true, plan: true },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.credits < config.credits.perSummary) {
        throw new AppError("Insufficient credits", 402);
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

      // Create pending summary record
      const pendingSummary = await prisma.summary.create({
        data: {
          title: data.videoMetadata.title,
          keyPoints: [],
          fullSummary: "",
          tags: [],
          status: "PROCESSING",
          videoId: data.videoMetadata.videoId,
          videoTitle: data.videoMetadata.title,
          channelName: data.videoMetadata.channelName,
          videoDuration: data.videoMetadata.duration,
          videoUrl: data.videoMetadata.url,
          thumbnailUrl: data.videoMetadata.thumbnailUrl,
          transcript: data.transcript as any,
          transcriptText: this.formatTranscriptText(data.transcript),
          userId,
        },
      });

      // Deduct credits immediately
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: config.credits.perSummary } },
      });

      try {
        // Generate summary using OpenAI
        const aiResult = await openaiService.generateSummary(
          data.transcript,
          data.videoMetadata
        );

        if (!aiResult.success || !aiResult.data) {
          throw new AppError(
            aiResult.error || "AI summary generation failed",
            500
          );
        }

        // Update summary with AI results
        const completedSummary = await prisma.summary.update({
          where: { id: pendingSummary.id },
          data: {
            keyPoints: aiResult.data.keyPoints,
            fullSummary: aiResult.data.fullSummary,
            tags: aiResult.data.tags,
            status: "COMPLETED",
          },
        });

        logger.info("Summary generated successfully", {
          userId,
          summaryId: completedSummary.id,
          videoId: data.videoMetadata.videoId,
        });

        return {
          success: true,
          data: this.formatSummary(completedSummary),
        };
      } catch (aiError) {
        // Mark summary as failed and refund credits
        await prisma.$transaction([
          prisma.summary.update({
            where: { id: pendingSummary.id },
            data: { status: "FAILED" },
          }),
          prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: config.credits.perSummary } },
          }),
        ]);

        throw aiError;
      }
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

      if (summaryData.id) {
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
        // Create new summary
        if (
          !summaryData.videoId ||
          !summaryData.videoTitle ||
          !summaryData.channelName
        ) {
          throw new AppError("Missing required video metadata", 400);
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
      videoMetadata: {
        videoId: summary.videoId,
        title: summary.videoTitle,
        channelName: summary.channelName,
        duration: summary.videoDuration,
        url: summary.videoUrl,
        thumbnailUrl: summary.thumbnailUrl,
      },
      transcript: summary.transcript as TranscriptSegment[],
      transcriptText: summary.transcriptText,
      createdAt: summary.createdAt.toISOString(),
      updatedAt: summary.updatedAt.toISOString(),
      saved: true,
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
