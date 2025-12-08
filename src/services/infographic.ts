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

      // Get full transcript text
      const transcriptText =
        data.transcriptText || summary.transcriptText || "";

      if (!transcriptText) {
        throw new AppError("Transcript not available for this video", 400);
      }

      logger.info("Using full transcript for infographic", {
        userId,
        summaryId: data.summaryId,
        transcriptLength: transcriptText.length,
      });

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

      // Generate image using Gemini 3 Pro Image (Nano Banana Pro)
      // State-of-the-art image generation with thinking mode
      const response = await this.ai.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents: prompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"], // BOTH required for this model
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "2K",
          },
        },
      });

      // Extract image from response parts
      if (!response.candidates || response.candidates.length === 0) {
        throw new AppError("Failed to generate infographic", 500);
      }

      const candidate = response.candidates[0];
      if (!candidate?.content?.parts) {
        throw new AppError("No content in response", 500);
      }

      // Debug: Log the response structure
      logger.info("Response parts received", {
        userId,
        summaryId: data.summaryId,
        partsCount: candidate.content.parts.length,
        partsTypes: candidate.content.parts.map((p: any) => ({
          hasText: !!p.text,
          hasInlineData: !!p.inlineData,
          mimeType: p.inlineData?.mimeType,
          hasData: !!p.inlineData?.data,
          isThought: !!p.thought,
        })),
      });

      // Extract image data from the response
      // Skip "thought" parts - only get final image from non-thought parts
      // Gemini 3 Pro uses thinking mode and generates interim thought images
      let imageData: string | null = null;
      for (const part of candidate.content.parts) {
        // Skip thought parts (thinking mode generates interim images we don't want)
        if (part.thought) {
          continue;
        }

        if (
          part.inlineData?.mimeType?.includes("image") &&
          part.inlineData?.data
        ) {
          imageData = part.inlineData.data;
          break;
        }
      }

      if (!imageData) {
        // Log full response for debugging
        logger.error("No image found in response", {
          userId,
          summaryId: data.summaryId,
          responseStructure: JSON.stringify(response, null, 2).substring(
            0,
            1000
          ),
        });
        throw new AppError("No image data in response", 500);
      }

      // Save image as file in uploads/infographics directory
      const filename = `infographic-${summary.id}.png`;
      const filepath = path.join(this.uploadsDir, filename);
      const imageUrl = `/uploads/infographics/${filename}`;

      // Decode base64 and write to file
      const buffer = Buffer.from(imageData, "base64");
      fs.writeFileSync(filepath, buffer);

      logger.info("Infographic saved to file", {
        userId,
        summaryId: data.summaryId,
        filepath,
        fileSize: buffer.length,
      });

      // Extract token usage from response
      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens =
        response.usageMetadata?.totalTokenCount || inputTokens + outputTokens;

      logger.info("Token usage for infographic generation", {
        userId,
        summaryId: data.summaryId,
        inputTokens,
        outputTokens,
        totalTokens,
      });

      // Update summary with infographic file path
      await prisma.summary.update({
        where: { id: summary.id },
        data: { infographicUrl: imageUrl }, // Store file path
      });

      // Track image generation usage with token counts
      await this.trackImageGenerationUsage({
        userId,
        userEmail: "", // Will be fetched from user
        videoId: summary.videoId,
        videoUrl: summary.videoUrl,
        videoTitle: summary.videoTitle,
        summaryId: summary.id,
        imageUrl: imageUrl, // Store file path
        numberOfImages: 1,
        inputTokens,
        outputTokens,
        totalTokens,
        status: "success",
      });

      logger.info("Infographic generated successfully", {
        userId,
        summaryId: data.summaryId,
        imageUrl,
        totalTokens,
        usageMetadata: response.usageMetadata,
      }); 
      return {
        success: true,
        data: {
          imageUrl: imageUrl, // Return file path
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
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
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
    return `Generate Image :- Take the following transcript and generate a detailed infographic image.
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
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
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
          inputTokens: data.inputTokens || 0,
          outputTokens: data.outputTokens || 0,
          totalTokens: data.totalTokens || 0,
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
