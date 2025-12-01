import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { ServiceResponse } from "../types";

export interface InfographicGenerationRequest {
  summaryId: string;
  transcriptText?: string;
}

export interface InfographicGenerationResponse {
  imageUrl: string;
  summaryId: string;
}

export class InfographicService {
  private ai: GoogleGenAI;
  private uploadsDir: string;

  constructor() {
    // Initialize Google GenAI
    this.ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
    });

    // Set up uploads directory for storing generated images
    this.uploadsDir = path.join(process.cwd(), "uploads", "infographics");
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Generate an infographic from the video transcript
   */
  async generateInfographic(
    userId: string,
    data: InfographicGenerationRequest
  ): Promise<ServiceResponse<InfographicGenerationResponse>> {
    try {
      logger.info("Starting infographic generation", {
        userId,
        summaryId: data.summaryId,
      });

      // Fetch the summary to get transcript
      const summary = await prisma.summary.findFirst({
        where: {
          id: data.summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Summary not found", 404);
      }

      // Check if infographic already exists
      if (summary.infographicUrl) {
        logger.info("Infographic already exists", {
          userId,
          summaryId: data.summaryId,
          infographicUrl: summary.infographicUrl,
        });

        return {
          success: true,
          data: {
            imageUrl: summary.infographicUrl,
            summaryId: summary.id,
          },
        };
      }

      // Get transcript text
      const transcriptText =
        data.transcriptText || summary.transcriptText || "";

      if (!transcriptText) {
        throw new AppError("Transcript not available for this video", 400);
      }

      // Use full transcript for infographic generation
      // Create prompt for infographic generation
      const prompt = this.createInfographicPrompt(
        transcriptText,
        summary.videoTitle
      );

      logger.info("Generating infographic with Google AI", {
        userId,
        summaryId: data.summaryId,
        promptLength: prompt.length,
      });

      // Generate image using Google AI
      const response = await this.ai.models.generateImages({
        model: "gemini-3-pro-image-preview",
        prompt: prompt,
        config: {
          numberOfImages: 1,
        },
      });

      if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new AppError("Failed to generate infographic", 500);
      }

      // Save the generated image
      const generatedImage = response.generatedImages[0];
      const imgBytes = generatedImage.image?.imageBytes;
      const buffer = Buffer.from(imgBytes || "", "base64");

      // Generate unique filename
      const filename = `infographic-${summary.id}-${Date.now()}.png`;
      const filepath = path.join(this.uploadsDir, filename);

      // Write file to disk
      fs.writeFileSync(filepath, buffer);

      // Create URL path (relative to the API)
      const imageUrl = `/uploads/infographics/${filename}`;

      logger.info("Infographic saved to disk", {
        userId,
        summaryId: data.summaryId,
        filepath,
        imageUrl,
      });

      // Update summary with infographic URL
      await prisma.summary.update({
        where: { id: summary.id },
        data: { infographicUrl: imageUrl },
      });

      // Track image generation usage
      await this.trackImageGenerationUsage({
        userId,
        userEmail: "", // Will be fetched from user
        videoId: summary.videoId,
        videoUrl: summary.videoUrl,
        videoTitle: summary.videoTitle,
        summaryId: summary.id,
        imageUrl: imageUrl,
        numberOfImages: 1,
        status: "success",
      });

      logger.info("Infographic generated successfully", {
        userId,
        summaryId: data.summaryId,
        imageUrl,
      });

      return {
        success: true,
        data: {
          imageUrl,
          summaryId: summary.id,
        },
      };
    } catch (error) {
      logger.error("Infographic generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId: data.summaryId,
      });

      // Track failed generation
      try {
        await this.trackImageGenerationUsage({
          userId,
          userEmail: "",
          videoId: "",
          videoUrl: "",
          videoTitle: "",
          summaryId: data.summaryId,
          imageUrl: null,
          numberOfImages: 0,
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      } catch (trackError) {
        logger.warn("Failed to track image generation error", { trackError });
      }

      throw error instanceof AppError
        ? error
        : new AppError("Failed to generate infographic", 500);
    }
  }

  /**
   * Create a prompt for infographic generation
   */
  private createInfographicPrompt(
    transcript: string,
    videoTitle: string
  ): string {
    return `Take the following transcript and generate a detailed infographic.
    Video Title: ${videoTitle}
    Transcript:
    ${transcript}
`;
  }

  /**
   * Track image generation usage in the database
   */
  private async trackImageGenerationUsage(data: {
    userId: string;
    userEmail: string;
    videoId: string;
    videoUrl: string;
    videoTitle: string;
    summaryId: string;
    imageUrl: string | null;
    numberOfImages: number;
    status: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      // Get user email if not provided
      let userEmail = data.userEmail;
      if (!userEmail) {
        const user = await prisma.user.findUnique({
          where: { id: data.userId },
          select: { email: true },
        });
        userEmail = user?.email || "";
      }

      await prisma.imageGenerationUsage.create({
        data: {
          userId: data.userId,
          userEmail: userEmail,
          videoId: data.videoId,
          videoUrl: data.videoUrl,
          videoTitle: data.videoTitle,
          summaryId: data.summaryId,
          imageUrl: data.imageUrl,
          numberOfImages: data.numberOfImages,
          status: data.status,
          errorMessage: data.errorMessage,
          model: "gemini-3-pro-image-preview",
          operation: "infographic_generation",
        },
      });

      logger.info("Image generation usage tracked", {
        userId: data.userId,
        summaryId: data.summaryId,
        status: data.status,
      });
    } catch (error) {
      logger.error("Failed to track image generation usage", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: data.userId,
      });
      // Don't throw - tracking failure shouldn't block the main operation
    }
  }

  /**
   * Get image generation statistics for a user
   */
  async getImageGenerationStats(userId: string): Promise<
    ServiceResponse<{
      totalGenerations: number;
      successfulGenerations: number;
      failedGenerations: number;
      generationsThisMonth: number;
    }>
  > {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalGenerations,
        successfulGenerations,
        failedGenerations,
        generationsThisMonth,
      ] = await Promise.all([
        prisma.imageGenerationUsage.count({
          where: { userId },
        }),
        prisma.imageGenerationUsage.count({
          where: {
            userId,
            status: "success",
          },
        }),
        prisma.imageGenerationUsage.count({
          where: {
            userId,
            status: "failed",
          },
        }),
        prisma.imageGenerationUsage.count({
          where: {
            userId,
            createdAt: { gte: startOfMonth },
          },
        }),
      ]);

      return {
        success: true,
        data: {
          totalGenerations,
          successfulGenerations,
          failedGenerations,
          generationsThisMonth,
        },
      };
    } catch (error) {
      logger.error("Get image generation stats failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get image generation statistics", 500);
    }
  }

  /**
   * Get all image generation usage records for a user
   */
  async getImageGenerationUsage(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<
    ServiceResponse<{
      data: any[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
      };
    }>
  > {
    try {
      const skip = (page - 1) * limit;

      const [usage, total] = await Promise.all([
        prisma.imageGenerationUsage.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.imageGenerationUsage.count({
          where: { userId },
        }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        data: {
          data: usage,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        },
      };
    } catch (error) {
      logger.error("Get image generation usage failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get image generation usage", 500);
    }
  }
}

export const infographicService = new InfographicService();
