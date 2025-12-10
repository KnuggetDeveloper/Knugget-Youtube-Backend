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
Sample Output :-
Slide 1
Heading: Embrace a 2030 Skill Shift to Stay Competitive
Explanation: By 2030, the skills required for most jobs will change about 70%. To stay competitive, rethink from first principles and reimagine how building products happens, leveraging AI to reshape the workflow.


Slide 2
Heading: Introduce the Full Stack Builder Model
Explanation: LinkedIn's approach enables any builder, regardless of role, to take an idea from concept to market. It's a fluid human-plus-AI interaction designed to shorten cycles and empower rapid end-to-end product development.


Slide 3
Heading: Move from Process-heavy to Craftsmanship-focused Dev Life Cycle
Explanation: The traditional multi-step, highly siloed product development process creates bloated complexity. The full stack builder model collapses this stack, focusing on craftsmanship and end-to-end ownership.


Slide 4
Heading: Three Core Enablers: Platform, Tools, Culture
Explanation: Rebuild the core platform for AI, develop specialized agents/tools, and cultivate a culture that incentivizes adoption and continuous improvement through leadership, norms, and recognition.


Slide 5
Heading: The Builder traits that Matter Most
Explanation: Vision, empathy, communication, creativity, and most importantly judgment (high-quality decision-making in ambiguity) are the core traits builders should excel at; automation should handle the rest.


Slide 6
Heading: The Role of Pods and Smaller, Nimble Teams
Explanation: Instead of large, bloated teams, LinkedIn uses cross-functional pods of full stack builders who tackle a problem for a quarter, then reconfigure, enabling velocity and sharpened focus.


Slide 7
Heading: The Magnitude of Change: Why automation and AI are Essential
Explanation: Change is happening faster than response times. The skill and organizational shifts are needed to keep pace with the velocity of change and the demands of the market.


Slide 8
Heading: The Three-Component Rollout: Platform, Tools, Culture
Explanation: Platform: rearchitect core to reason over AI with composable UI components; Tools: build and orchestrate AI agents (trust, growth, research, etc.); Culture: foster adoption through incentives, visibility, and leadership modeling.


Slide 9
Heading: Practical AI Agents: Custom, Not Off-the-Shelf
Explanation: LinkedIn builds purpose-built agents (trust, growth, research, analyst, etc.) tailored to their data and context, plus an orchestrator layer to coordinate interactions between agents.


Slide 10
Heading: The Importance of Data Curation over Raw Access
Explanation: Feeding AI with the right data is crucial. Simply granting broad data access led to poor results and hallucinations. Curate "gold" examples and define the knowledge base carefully.


Slide 11
Heading: Experimentation Scale: Velocity x Quality
Explanation: Measure impact by the volume of experiments times the quality and speed from idea to launch. Early wins come from strong adoption by top performers who model success for others.


Slide 12
Heading: The Associate Full Stack Builder Program (APB)
Explanation: Replacing the APM program, APB trains and places individuals across pods, teaching coding, design, and PM skills so they can contribute end-to-end in a modern LD environment.


Slide 13
Heading: Change Management as a Critical Lever
Explanation: Adoption requires incentives, visible success stories, and a top-down-to-grassroots push. Culture, expectations, and performance processes must align with the new way of working.


Slide 14
Heading: What's Been Shown: Early Wins and Lessons
Explanation: Early adopters deliver time savings and higher-quality outputs. Top performers gain the most benefit, signaling the need to expand adoption gradually and celebrate wins to build momentum.


Slide 15
Heading: The Future of Work at LinkedIn and Beyond
Explanation: The model could redefine how companies operate, enabling agile, resilient, and fast-moving product teams. The key is continuous progress, not a fixed endpoint, with upfront investment in platform, tools, and culture.
`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const text = response.text || "";

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

      // Extract heading
      const headingMatch = content.match(
        /Heading:\s*(.+?)(?:\n|Explanation:)/is
      );
      const heading = headingMatch ? headingMatch[1].trim() : "";

      // Extract explanation
      const explanationMatch = content.match(
        /Explanation:\s*(.+?)(?:$|Slide)/is
      );
      const explanation = explanationMatch ? explanationMatch[1].trim() : "";

      if (heading && explanation) {
        slides.push({
          slideNumber: slideNum,
          heading,
          explanation,
        });
      }
    }

    logger.info("Parsed slide content", {
      slideCount: slides.length,
      slides: slides.map((s) => ({
        num: s.slideNumber,
        heading: s.heading.substring(0, 50),
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
      prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${slideNumber}/${totalSlides} : ${heading} + ${explanation}.`;

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

        prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${slideNumber}/${totalSlides} : ${heading} + ${explanation}. Follow the design style as per the image attached`;

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
        prompt = `Generate an infographic for a YouTube Podcast with the title ${videoTitle} from ${channelName}. This is the content for the slide ${slideNumber}/${totalSlides} : ${heading} + ${explanation}.`;

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
