import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { ServiceResponse } from "../types";

export interface CarouselSlide {
  slideNumber: number;
  heading: string;
  explanation: string;
  imageUrl: string | null;
  status: string;
}

export interface CarouselGenerationRequest {
  summaryId: string;
  transcriptText?: string;
}

export interface CarouselGenerationResponse {
  summaryId: string;
  slides: CarouselSlide[];
  totalSlides: number;
  completedSlides: number;
  status: string;
}

export class CarouselService {
  private ai: GoogleGenAI;
  private uploadsDir: string;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
    });

    // Set up uploads directory for carousel images
    this.uploadsDir = path.join(process.cwd(), "uploads", "carousel");
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Generate carousel slides from transcript
   */
  async generateCarousel(
    userId: string,
    data: CarouselGenerationRequest
  ): Promise<ServiceResponse<CarouselGenerationResponse>> {
    try {
      logger.info("Starting carousel generation", {
        userId,
        summaryId: data.summaryId,
      });

      // Fetch the summary
      const summary = await prisma.summary.findFirst({
        where: {
          id: data.summaryId,
          userId,
        },
      });

      if (!summary) {
        throw new AppError("Summary not found", 404);
      }

      // Check if carousel already exists
      const existingSlides = await prisma.carouselSlide.findMany({
        where: {
          summaryId: data.summaryId,
          userId,
        },
        orderBy: { slideNumber: "asc" },
      });

      if (existingSlides.length > 0) {
        // Check if all slides have images
        const allCompleted = existingSlides.every(
          (s) => s.status === "completed" && s.imageUrl
        );

        if (allCompleted) {
          logger.info("Carousel already exists", {
            userId,
            summaryId: data.summaryId,
            slideCount: existingSlides.length,
          });

          return {
            success: true,
            data: {
              summaryId: summary.id,
              slides: existingSlides.map((s) => ({
                slideNumber: s.slideNumber,
                heading: s.heading,
                explanation: s.explanation,
                imageUrl: s.imageUrl,
                status: s.status,
              })),
              totalSlides: existingSlides.length,
              completedSlides: existingSlides.filter(
                (s) => s.status === "completed"
              ).length,
              status: "completed",
            },
          };
        }
      }

      // Get transcript text
      const transcriptText =
        data.transcriptText || summary.transcriptText || "";

      if (!transcriptText) {
        throw new AppError("Transcript not available for this video", 400);
      }

      // Step 1: Generate slide content from transcript
      logger.info("Generating slide content from transcript", {
        userId,
        summaryId: data.summaryId,
        transcriptLength: transcriptText.length,
      });

      const slideContents = await this.generateSlideContent(
        transcriptText,
        summary.videoTitle
      );

      if (slideContents.length === 0) {
        throw new AppError("Failed to generate slide content", 500);
      }

      // Step 2: Create/update slide records in database
      const slides: CarouselSlide[] = [];

      for (const content of slideContents) {
        // Upsert slide record
        const slide = await prisma.carouselSlide.upsert({
          where: {
            summaryId_slideNumber: {
              summaryId: data.summaryId,
              slideNumber: content.slideNumber,
            },
          },
          update: {
            heading: content.heading,
            explanation: content.explanation,
            status: "pending",
          },
          create: {
            summaryId: data.summaryId,
            userId,
            slideNumber: content.slideNumber,
            heading: content.heading,
            explanation: content.explanation,
            status: "pending",
          },
        });

        slides.push({
          slideNumber: slide.slideNumber,
          heading: slide.heading,
          explanation: slide.explanation,
          imageUrl: slide.imageUrl,
          status: slide.status,
        });
      }

      // Step 3: Start image generation in BACKGROUND (non-blocking)
      // This allows the frontend to poll for progress
      logger.info("Starting image generation for slides in background", {
        userId,
        summaryId: data.summaryId,
        slideCount: slides.length,
      });

      // Start background generation (don't await)
      this.generateImagesInBackground(
        userId,
        data.summaryId,
        summary.videoId,
        summary.videoUrl,
        summary.videoTitle,
        summary.channelName,
        slides
      );

      // Return immediately with "generating" status
      // Frontend will poll getCarouselSlides to check progress
      return {
        success: true,
        data: {
          summaryId: summary.id,
          slides,
          totalSlides: slides.length,
          completedSlides: 0,
          status: "generating",
        },
      };
    } catch (error) {
      logger.error("Carousel generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId: data.summaryId,
      });

      throw error instanceof AppError
        ? error
        : new AppError("Failed to generate carousel", 500);
    }
  }

  /**
   * Generate images in background (non-blocking)
   * This allows the API to return immediately while images generate
   */
  private async generateImagesInBackground(
    userId: string,
    summaryId: string,
    videoId: string,
    videoUrl: string,
    videoTitle: string,
    channelName: string,
    slides: CarouselSlide[]
  ): Promise<void> {
    let firstImageUrl: string | null = null;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];

      try {
        // Update status to generating
        await prisma.carouselSlide.update({
          where: {
            summaryId_slideNumber: {
              summaryId: summaryId,
              slideNumber: slide.slideNumber,
            },
          },
          data: { status: "generating" },
        });

        // Generate image
        const imageResult = await this.generateSlideImage(
          videoTitle,
          channelName,
          slide.slideNumber,
          slides.length,
          slide.heading,
          slide.explanation,
          summaryId,
          firstImageUrl // Pass first image for style reference
        );

        // Store first image URL for subsequent slides
        if (i === 0 && imageResult.imageUrl) {
          firstImageUrl = imageResult.imageUrl;
        }

        // Update slide with image URL
        await prisma.carouselSlide.update({
          where: {
            summaryId_slideNumber: {
              summaryId: summaryId,
              slideNumber: slide.slideNumber,
            },
          },
          data: {
            imageUrl: imageResult.imageUrl,
            inputTokens: imageResult.inputTokens,
            outputTokens: imageResult.outputTokens,
            totalTokens: imageResult.totalTokens,
            status: "completed",
          },
        });

        logger.info("Slide image generated", {
          userId,
          summaryId: summaryId,
          slideNumber: slide.slideNumber,
          imageUrl: imageResult.imageUrl,
        });
      } catch (error) {
        logger.error("Failed to generate image for slide", {
          error: error instanceof Error ? error.message : "Unknown error",
          slideNumber: slide.slideNumber,
        });

        // Mark slide as failed
        await prisma.carouselSlide.update({
          where: {
            summaryId_slideNumber: {
              summaryId: summaryId,
              slideNumber: slide.slideNumber,
            },
          },
          data: {
            status: "failed",
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    // Track image generation usage after all slides are processed
    const completedCount = await prisma.carouselSlide.count({
      where: {
        summaryId: summaryId,
        status: "completed",
      },
    });

    await this.trackCarouselUsage({
      userId,
      summaryId: summaryId,
      videoId: videoId,
      videoUrl: videoUrl,
      videoTitle: videoTitle,
      numberOfImages: completedCount,
      status: completedCount === slides.length ? "success" : "partial",
    });

    logger.info("Background carousel generation completed", {
      userId,
      summaryId,
      totalSlides: slides.length,
      completedSlides: completedCount,
    });
  }

  /**
   * Get existing carousel slides for a summary
   */
  async getCarouselSlides(
    userId: string,
    summaryId: string
  ): Promise<ServiceResponse<CarouselGenerationResponse | null>> {
    try {
      const slides = await prisma.carouselSlide.findMany({
        where: {
          summaryId,
          userId,
        },
        orderBy: { slideNumber: "asc" },
      });

      if (slides.length === 0) {
        return {
          success: true,
          data: null,
        };
      }

      const completedSlides = slides.filter(
        (s) => s.status === "completed"
      ).length;

      return {
        success: true,
        data: {
          summaryId,
          slides: slides.map((s) => ({
            slideNumber: s.slideNumber,
            heading: s.heading,
            explanation: s.explanation,
            imageUrl: s.imageUrl,
            status: s.status,
          })),
          totalSlides: slides.length,
          completedSlides,
          status:
            completedSlides === slides.length
              ? "completed"
              : completedSlides > 0
              ? "partial"
              : "pending",
        },
      };
    } catch (error) {
      logger.error("Failed to get carousel slides", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        summaryId,
      });
      throw new AppError("Failed to get carousel slides", 500);
    }
  }

  /**
   * Generate slide content from transcript using AI
   */
  private async generateSlideContent(
    transcript: string,
    videoTitle: string
  ): Promise<
    Array<{ slideNumber: number; heading: string; explanation: string }>
  > {
    const prompt = `Generate a very very detailed note of all the key points mentioned in this transcript. Do not exceed 15 key points. Therefore intelligently identify the most high value 15 key points from this transcript. Present it in the format "Slide [N] \n Heading: [Punchy action-oriented title] \n Explanation: [The detailed key note points corresponding to the heading from the transcript]", Transcript: ${transcript}
`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    // Extract text from response - handle different response structures
    let text = "";
    if (response.text) {
      text = response.text;
    } else if (response.candidates && response.candidates[0]?.content?.parts) {
      // Fallback: extract text from parts
      text = response.candidates[0].content.parts
        .map((part: any) => part.text || "")
        .join("");
    } else {
      // Last resort: stringify the response
      text = JSON.stringify(response);
    }

    // Log the raw output from Gemini Flash
    logger.info("Raw Gemini Flash output", {
      responseLength: text.length,
      first500Chars: text.substring(0, 500),
      fullResponse: text, // Full response for debugging
      responseStructure: {
        hasText: !!response.text,
        hasCandidates: !!response.candidates,
        candidatesCount: response.candidates?.length || 0,
      },
    });

    // Parse the response to extract slides
    const slides: Array<{
      slideNumber: number;
      heading: string;
      explanation: string;
    }> = [];

    // Split by "Slide" keyword
    const slideMatches = text.split(/Slide\s+(\d+)/gi);

    for (let i = 1; i < slideMatches.length; i += 2) {
      const slideNum = parseInt(slideMatches[i], 10);
      const content = slideMatches[i + 1] || "";

      // Extract heading - try multiple patterns
      let heading = "";
      const headingPatterns = [
        /Heading:\s*([^\n]+?)(?:\n\s*\n|Explanation:)/is,
        /Heading:\s*([^\n]+)/i,
        /Heading:\s*(.+?)(?:\n|$)/is,
      ];

      for (const pattern of headingPatterns) {
        const match = content.match(pattern);
        if (match) {
          heading = match[1].trim();
          break;
        }
      }

      // Extract explanation - try multiple patterns
      let explanation = "";
      const explanationPatterns = [
        /Explanation:\s*([\s\S]+?)(?=\n\s*Slide\s+\d+|$)/i,
        /Explanation:\s*([\s\S]+?)(?=\n\s*\n\s*Slide|$)/i,
        /Explanation:\s*([\s\S]+)/i,
      ];

      for (const pattern of explanationPatterns) {
        const match = content.match(pattern);
        if (match) {
          explanation = match[1].trim();
          // Remove trailing newlines and clean up
          explanation = explanation.replace(/\n\s*\n\s*Slide.*$/is, "").trim();
          if (explanation) break;
        }
      }

      // Log each slide extraction for debugging
      logger.info("Extracting slide", {
        slideNumber: slideNum,
        hasHeading: !!heading,
        hasExplanation: !!explanation,
        headingPreview: heading.substring(0, 50),
        explanationPreview: explanation.substring(0, 100),
        contentPreview: content.substring(0, 200),
      });

      if (heading && explanation) {
        slides.push({
          slideNumber: slideNum,
          heading,
          explanation,
        });
      } else {
        logger.warn("Slide missing heading or explanation", {
          slideNumber: slideNum,
          heading: heading || "MISSING",
          explanation: explanation || "MISSING",
        });
      }
    }

    logger.info("Parsed slide content", {
      slideCount: slides.length,
      slides: slides.map((s) => ({
        num: s.slideNumber,
        heading: s.heading.substring(0, 50),
        explanationLength: s.explanation.length,
        explanationPreview: s.explanation.substring(0, 100),
      })),
    });

    return slides;
  }

  /**
   * Generate image for a single slide
   */
  private async generateSlideImage(
    videoTitle: string,
    channelName: string,
    slideNumber: number,
    totalSlides: number,
    heading: string,
    explanation: string,
    summaryId: string,
    styleReferenceImageUrl: string | null
  ): Promise<{
    imageUrl: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }> {
    let prompt: string;
    let contents: any;

    if (slideNumber === 1 || !styleReferenceImageUrl) {
      // First slide - no style reference
      prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${heading} + ${explanation}.`;

      contents = prompt;
    } else {
      // Subsequent slides - include style reference
      const styleImagePath = path.join(
        process.cwd(),
        styleReferenceImageUrl.replace(/^\//, "")
      );

      if (fs.existsSync(styleImagePath)) {
        const imageData = fs.readFileSync(styleImagePath);
        const base64Image = imageData.toString("base64");

        prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${heading} + ${explanation}. Follow the design style as per the image attached`;

        contents = [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          },
        ];
      } else {
        // Fallback if style reference image not found
        prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${heading} + ${explanation}.`;

        contents = prompt;
      }
    }

    // Generate image using Gemini (same model as infographic)
    const response = await this.ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"], // BOTH required for this model
        imageConfig: {
          aspectRatio: "1:1", // Square for carousel
          imageSize: "2K",
        },
      },
    });

    // Extract image from response
    if (!response.candidates || response.candidates.length === 0) {
      throw new AppError("Failed to generate slide image", 500);
    }

    const candidate = response.candidates[0];
    if (!candidate?.content?.parts) {
      throw new AppError("No content in response", 500);
    }

    let imageData: string | null = null;
    for (const part of candidate.content.parts) {
      if ((part as any).thought) continue;
      if (
        part.inlineData?.mimeType?.includes("image") &&
        part.inlineData?.data
      ) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (!imageData) {
      throw new AppError("No image data in response", 500);
    }

    // Save image to file
    const filename = `carousel-${summaryId}-slide-${slideNumber}.png`;
    const filepath = path.join(this.uploadsDir, filename);
    const imageUrl = `/uploads/carousel/${filename}`;

    const buffer = Buffer.from(imageData, "base64");
    fs.writeFileSync(filepath, buffer);

    // Extract token usage
    const inputTokens = response.usageMetadata?.promptTokenCount || 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
    const totalTokens =
      response.usageMetadata?.totalTokenCount || inputTokens + outputTokens;

    return {
      imageUrl,
      inputTokens,
      outputTokens,
      totalTokens,
    };
  }

  /**
   * Track carousel generation usage
   */
  private async trackCarouselUsage(data: {
    userId: string;
    summaryId: string;
    videoId: string;
    videoUrl: string;
    videoTitle: string;
    numberOfImages: number;
    status: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { email: true },
      });

      await prisma.imageGenerationUsage.create({
        data: {
          userId: data.userId,
          userEmail: user?.email || "",
          videoId: data.videoId,
          videoUrl: data.videoUrl,
          videoTitle: data.videoTitle,
          summaryId: data.summaryId,
          numberOfImages: data.numberOfImages,
          status: data.status,
          errorMessage: data.errorMessage,
          model: "gemini-3-pro-image-preview",
          operation: "carousel_generation",
        },
      });

      logger.info("Carousel usage tracked", {
        userId: data.userId,
        summaryId: data.summaryId,
        numberOfImages: data.numberOfImages,
        status: data.status,
      });
    } catch (error) {
      logger.error("Failed to track carousel usage", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

export const carouselService = new CarouselService();
