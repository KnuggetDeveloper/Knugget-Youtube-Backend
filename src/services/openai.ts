import OpenAI from "openai";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "../config/database";
import {
  TranscriptSegment,
  VideoMetadata,
  OpenAISummaryResponse,
  ServiceResponse,
  MAX_TRANSCRIPT_LENGTH,
} from "../types";
import { tokenService } from "./token";

interface OpenAICompletionRequest {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

interface OpenAICompletionResponse {
  trim(): string | undefined;
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
export class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  // Track OpenAI usage
  private async trackUsage(
    userId: string,
    operation: string,
    model: string,
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
    videoId?: string,
    summaryId?: string
  ): Promise<void> {
    try {
      await prisma.openAIUsage.create({
        data: {
          userId,
          operation,
          model,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          videoId,
          summaryId,
        },
      });

      logger.info("OpenAI usage tracked", {
        userId,
        operation,
        model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      });
    } catch (error) {
      logger.error("Failed to track OpenAI usage", {
        error,
        userId,
        operation,
      });
      // Don't throw error as tracking failure shouldn't break the main operation
    }
  }

  // Generate summary from transcript
  async generateSummary(
    transcript: TranscriptSegment[],
    videoMetadata: VideoMetadata,
    userId?: string
  ): Promise<ServiceResponse<OpenAISummaryResponse>> {
    try {
      const transcriptText = this.formatTranscriptForAI(transcript);

      // Check token availability for all users (FREE, LITE, PRO)
      if (userId) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { plan: true },
        });

        if (user) {
          // Estimate token usage
          const estimatedUsage =
            tokenService.estimateTokenUsage(transcriptText);

          // Check if user has enough tokens
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
        }
      }

      if (transcriptText.length > MAX_TRANSCRIPT_LENGTH) {
        // Chunk large transcripts
        return this.generateSummaryFromChunks(
          transcript,
          videoMetadata,
          userId
        );
      }

      const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
      const OPENAI_API_KEY = config.openai.apiKey;

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that creates structured summaries in JSON format. Always respond with valid JSON only.",
            },
            {
              role: "user",
              content: `Analyze this transcript and create a comprehensive summary in JSON format.

**REQUIRED JSON STRUCTURE:**
{
  "keyTakeaways": [
    "First key takeaway - be very specific and detailed with full context",
    "Second key takeaway - be very specific and detailed with full context",
    "Third key takeaway - be very specific and detailed with full context"
  ],
  "quotes": [
    "First memorable quote from the transcript",
    "Second memorable quote from the transcript",
    "Third memorable quote from the transcript"
  ],
  "examples": [
    "First example or case study mentioned with full description",
    "Second example or case study mentioned with full description",
    "Third example or case study mentioned with full description"
  ],
  "detailedNotes": [
    {
      "title": "Topic or Section Title",
      "content": "Detailed explanation of this topic with full context and key details"
    }
  ]
}

**INSTRUCTIONS:**
1. Extract exactly 3 key takeaways (most important insights)
2. Extract exactly 3 memorable quotes (actual quotes from the transcript)
3. Extract exactly 3 examples (case studies, projects, or specific examples mentioned)
4. Create multiple detailed notes covering all major topics (as many as needed)
5. Make each item detailed and comprehensive
6. Return ONLY valid JSON, no additional text

**Transcript to analyze:**
${transcriptText}`,
            },
          ],
          reasoning_effort: "minimal",
          verbosity: "high",
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        throw new AppError(
          `OpenAI API error: ${response.status}`,
          response.status
        );
      }

      const responseData = await response.json();
      const responseText = responseData.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new AppError("Empty response from OpenAI", 500);
      }

      // Track OpenAI usage if userId is provided
      if (userId && responseData.usage) {
        try {
          await this.trackUsage(
            userId,
            "summary_generation",
            "gpt-5-nano",
            responseData.usage,
            videoMetadata.videoId
          );

          // Consume tokens for all users (FREE, LITE, PRO)
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { plan: true },
          });

          if (user) {
            try {
              await tokenService.consumeTokens(userId, {
                inputTokens: responseData.usage.prompt_tokens,
                outputTokens: responseData.usage.completion_tokens,
              });
            } catch (tokenError) {
              logger.warn("Failed to consume tokens", {
                tokenError,
                userId,
                usage: responseData.usage,
              });
            }
          }
        } catch (trackingError) {
          // Continue operation even if tracking fails
          logger.warn("Failed to track OpenAI usage", {
            trackingError,
            userId,
          });
        }
      }

      // Parse the JSON response
      const summaryData = this.parseJSONResponse(responseText, videoMetadata);

      // Add usage information to response
      if (responseData.usage) {
        summaryData.usage = {
          promptTokens: responseData.usage.prompt_tokens,
          completionTokens: responseData.usage.completion_tokens,
          totalTokens: responseData.usage.total_tokens,
        };
      }

      logger.info("Summary generated successfully", {
        videoId: videoMetadata.videoId,
        keyPointsCount: summaryData.keyPoints.length,
        tagsCount: summaryData.tags.length,
        transcriptLength: transcriptText.length,
        usage: responseData.usage,
      });

      return { success: true, data: summaryData };
    } catch (error: unknown) {
      logger.error("Summary generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        videoId: videoMetadata.videoId,
        transcriptLength: transcript.length,
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Summary generation failed", 500);
    }
  }

  // Handle large transcripts by chunking
  private async generateSummaryFromChunks(
    transcript: TranscriptSegment[],
    videoMetadata: VideoMetadata,
    userId?: string
  ): Promise<ServiceResponse<OpenAISummaryResponse>> {
    try {
      const chunks = this.chunkTranscript(transcript);
      const chunkSummaries: string[] = [];

      // Process each chunk with the same detailed prompt
      for (let i = 0; i < chunks.length; i++) {
        try {
          const chunkText = this.formatTranscriptForAI(chunks[i]);

          logger.info("Processing chunk", {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            chunkLength: chunkText.length,
          });

          const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
          const OPENAI_API_KEY = config.openai.apiKey;

          const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-5-nano",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant that creates structured summaries in JSON format. Always respond with valid JSON only.",
                },
                {
                  role: "user",
                  content: `Analyze this transcript chunk (Part ${i + 1} of ${
                    chunks.length
                  }) and extract key information in JSON format.

**REQUIRED JSON STRUCTURE:**
{
  "keyTakeaways": ["insight 1", "insight 2", ...],
  "quotes": ["quote 1", "quote 2", ...],
  "examples": ["example 1", "example 2", ...],
  "detailedNotes": [
    { "title": "Topic 1", "content": "Detailed explanation..." },
    { "title": "Topic 2", "content": "Detailed explanation..." }
  ]
}

Extract all relevant information from this chunk. Return ONLY valid JSON, no additional text.

Transcript Chunk ${i + 1}/${chunks.length}:
${chunkText}`,
                },
              ],
              reasoning_effort: "minimal",
              verbosity: "high",
              response_format: { type: "json_object" },
            }),
          });

          if (!response.ok) {
            throw new AppError(
              `OpenAI API error for chunk ${i + 1}: ${response.status}`,
              response.status
            );
          }

          const responseData = await response.json();
          const chunkSummary = responseData.choices?.[0]?.message?.content;

          // Track usage for chunk processing
          if (userId && responseData.usage) {
            try {
              await this.trackUsage(
                userId,
                "chunk_summary",
                "gpt-5-nano",
                responseData.usage,
                videoMetadata.videoId
              );

              // Consume tokens for all users (FREE, LITE, PRO)
              const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { plan: true },
              });

              if (user) {
                try {
                  await tokenService.consumeTokens(userId, {
                    inputTokens: responseData.usage.prompt_tokens,
                    outputTokens: responseData.usage.completion_tokens,
                  });
                } catch (tokenError) {
                  logger.warn("Failed to consume tokens for chunk", {
                    tokenError,
                    userId,
                    usage: responseData.usage,
                  });
                }
              }
            } catch (trackingError) {
              logger.warn("Failed to track chunk usage", {
                trackingError,
                userId,
              });
            }
          }

          if (chunkSummary) {
            chunkSummaries.push(chunkSummary);
          }

          // Add delay to avoid rate limiting
          if (i < chunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (chunkError) {
          logger.error("Error processing chunk", {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            error:
              chunkError instanceof Error
                ? chunkError.message
                : "Unknown error",
          });
          // Continue with other chunks even if one fails
        }
      }

      // Combine chunk summaries into final summary using the same detailed prompt
      const combinedSummary = chunkSummaries.join("\n\n");

      const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
      const OPENAI_API_KEY = config.openai.apiKey;

      const finalResponse = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5-nano",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that creates structured summaries in JSON format. Always respond with valid JSON only.",
            },
            {
              role: "user",
              content: `I have processed a long transcript in multiple parts. Here are the JSON summaries from each part:

${combinedSummary}

Now synthesize all parts into a comprehensive final summary in JSON format.

**REQUIRED JSON STRUCTURE:**
{
  "keyTakeaways": [
    "First key takeaway - synthesized from all parts",
    "Second key takeaway - synthesized from all parts",
    "Third key takeaway - synthesized from all parts"
  ],
  "quotes": [
    "First memorable quote from the transcript",
    "Second memorable quote from the transcript",
    "Third memorable quote from the transcript"
  ],
  "examples": [
    "First example or case study mentioned across all parts",
    "Second example or case study mentioned across all parts",
    "Third example or case study mentioned across all parts"
  ],
  "detailedNotes": [
    {
      "title": "Topic Title",
      "content": "Detailed explanation synthesizing information from all parts"
    }
  ]
}

**INSTRUCTIONS:**
1. Synthesize the top 3 key takeaways from all parts
2. Select the top 3 most memorable quotes from all parts
3. Select the top 3 best examples from all parts
4. Create comprehensive detailed notes covering all major topics
5. Return ONLY valid JSON, no additional text`,
            },
          ],
          reasoning_effort: "minimal",
          verbosity: "high",
          response_format: { type: "json_object" },
        }),
      });

      if (!finalResponse.ok) {
        throw new AppError(
          `OpenAI API error for final summary: ${finalResponse.status}`,
          finalResponse.status
        );
      }

      const finalResponseData = await finalResponse.json();

      // Track usage for final summary
      if (userId && finalResponseData.usage) {
        try {
          await this.trackUsage(
            userId,
            "final_summary",
            "gpt-5-nano",
            finalResponseData.usage,
            videoMetadata.videoId
          );

          // Consume tokens for all users (FREE, LITE, PRO)
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { plan: true },
          });

          if (user) {
            try {
              await tokenService.consumeTokens(userId, {
                inputTokens: finalResponseData.usage.prompt_tokens,
                outputTokens: finalResponseData.usage.completion_tokens,
              });
            } catch (tokenError) {
              logger.warn("Failed to consume tokens for final summary", {
                tokenError,
                userId,
                usage: finalResponseData.usage,
              });
            }
          }
        } catch (trackingError) {
          logger.warn("Failed to track final summary usage", {
            trackingError,
            userId,
          });
        }
      }

      const finalResponseText =
        finalResponseData.choices?.[0]?.message?.content;
      if (!finalResponseText) {
        throw new AppError("Empty response from OpenAI for final summary", 500);
      }

      // Parse the JSON response
      const summaryData = this.parseJSONResponse(
        finalResponseText,
        videoMetadata
      );

      // Add usage information to response
      if (finalResponseData.usage) {
        summaryData.usage = {
          promptTokens: finalResponseData.usage.prompt_tokens,
          completionTokens: finalResponseData.usage.completion_tokens,
          totalTokens: finalResponseData.usage.total_tokens,
        };
      }

      logger.info("Chunked summary generated successfully", {
        videoId: videoMetadata.videoId,
        chunksProcessed: chunks.length,
        keyPointsCount: summaryData.keyPoints.length,
        usage: finalResponseData.usage,
      });

      return { success: true, data: summaryData };
    } catch (error) {
      logger.error("Chunked summary generation failed", {
        error,
        videoId: videoMetadata.videoId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Summary generation failed", 500);
    }
  }

  // Chunk transcript into manageable pieces
  private chunkTranscript(
    transcript: TranscriptSegment[]
  ): TranscriptSegment[][] {
    const chunks: TranscriptSegment[][] = [];
    const maxChunkLength = Math.floor(MAX_TRANSCRIPT_LENGTH / 3); // Conservative chunking

    let currentChunk: TranscriptSegment[] = [];
    let currentLength = 0;

    for (const segment of transcript) {
      const segmentLength = segment.text.length;

      if (
        currentLength + segmentLength > maxChunkLength &&
        currentChunk.length > 0
      ) {
        chunks.push([...currentChunk]);
        currentChunk = [segment];
        currentLength = segmentLength;
      } else {
        currentChunk.push(segment);
        currentLength += segmentLength;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  // Format transcript segments for AI processing
  private formatTranscriptForAI(transcript: TranscriptSegment[]): string {
    return transcript
      .map((segment) => `[${segment.timestamp}] ${segment.text}`)
      .join("\n");
  }

  // Create chunk summary prompt
  private createChunkSummaryPrompt(
    chunkText: string,
    chunkNumber: number,
    totalChunks: number
  ): string {
    return `Generate a very very detailed note of all the key points mentioned in this transcript. From that generate the top 3 key takeaways, top 3 memorable quotes, top 3 examples. Present the final output starting with the top 3 key takeaways, top 3 memorable quotes, top 3 examples followed by the detailed note of all the key points.
                    Transcript: ${chunkText}`;
  }

  // Create final summary prompt for chunked content
  private createFinalSummaryPrompt(
    combinedSummary: string,
    videoMetadata: VideoMetadata
  ): string {
    return `Generate a very very detailed note of all the key points mentioned in this transcript. From that generate the top 3 key takeaways, top 3 memorable quotes, top 3 examples. Present the final output starting with the top 3 key takeaways, top 3 memorable quotes, top 3 examples followed by the detailed note of all the key points.
                    Transcript: ${combinedSummary}`;
  }

  // Parse the new format response from gpt-5-nano
  private parseJSONResponse(
    responseText: string,
    videoMetadata: VideoMetadata
  ): OpenAISummaryResponse {
    try {
      // Parse the JSON response
      const jsonResponse = JSON.parse(responseText);

      // Format the fullSummary from the structured JSON
      let fullSummary = "";

      // Add Top 3 Key Takeaways
      if (jsonResponse.keyTakeaways && jsonResponse.keyTakeaways.length > 0) {
        fullSummary += "Top 3 Key Takeaways\n";
        jsonResponse.keyTakeaways.forEach((item: string) => {
          fullSummary += `- ${item}\n`;
        });
        fullSummary += "\n";
      }

      // Add Top 3 Memorable Quotes
      if (jsonResponse.quotes && jsonResponse.quotes.length > 0) {
        fullSummary += "Top 3 Memorable Quotes\n";
        jsonResponse.quotes.forEach((item: string) => {
          fullSummary += `- ${item}\n`;
        });
        fullSummary += "\n";
      }

      // Add Top 3 Examples
      if (jsonResponse.examples && jsonResponse.examples.length > 0) {
        fullSummary += "Top 3 Examples\n";
        jsonResponse.examples.forEach((item: string) => {
          fullSummary += `- ${item}\n`;
        });
        fullSummary += "\n";
      }

      // Add Detailed Note of All Key Points
      if (jsonResponse.detailedNotes && jsonResponse.detailedNotes.length > 0) {
        fullSummary += "Detailed Note of All Key Points\n";
        jsonResponse.detailedNotes.forEach(
          (note: { title: string; content: string }) => {
            fullSummary += `- ${note.title}: ${note.content}\n`;
          }
        );
      }

      // Extract key points for backward compatibility
      const keyPoints = jsonResponse.keyTakeaways || [
        "Key insights extracted from the video",
      ];

      // Generate tags from the content
      const allText = fullSummary.toLowerCase();
      const commonTags = [
        "education",
        "tutorial",
        "tips",
        "guide",
        "learning",
        "insights",
        "analysis",
      ];
      const tags = commonTags.filter((tag) => allText.includes(tag));

      // If no tags found, create some generic ones
      if (tags.length === 0) {
        tags.push("video-summary", "key-insights", "learning");
      }

      return {
        keyPoints: keyPoints.slice(0, 5), // Limit to 5 key points
        fullSummary:
          fullSummary.trim() || "Detailed summary of the video content",
        tags: tags.slice(0, 5), // Limit to 5 tags
      };
    } catch (error) {
      logger.error("Failed to parse JSON response, falling back to text", {
        error,
        responsePreview: responseText.substring(0, 200),
      });

      // Fallback: return the text as-is
      return {
        keyPoints: ["Key insights extracted from the video"],
        fullSummary: responseText,
        tags: ["video-summary", "key-insights", "learning"],
      };
    }
  }

  // Validate AI response structure
  private validateSummaryResponse(
    response: any
  ): response is OpenAISummaryResponse {
    return (
      response &&
      Array.isArray(response.keyPoints) &&
      response.keyPoints.length > 0 &&
      response.keyPoints.every((point: any) => typeof point === "string") &&
      typeof response.fullSummary === "string" &&
      response.fullSummary.length > 0 &&
      Array.isArray(response.tags) &&
      response.tags.every((tag: any) => typeof tag === "string")
    );
  }

  // Test OpenAI connection
  async testConnection(): Promise<ServiceResponse<boolean>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 5,
      });

      const hasResponse = !!completion.choices[0]?.message?.content;

      return { success: true, data: hasResponse };
    } catch (error) {
      logger.error("OpenAI connection test failed", { error });
      return { success: false, error: "OpenAI connection failed" };
    }
  }

  async generateCompletion(
    request: OpenAICompletionRequest
  ): Promise<ServiceResponse<OpenAICompletionResponse>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: request.model || config.openai.model,
        messages: request.messages,
        max_tokens: request.maxTokens || 500,
        temperature: request.temperature || 0.3,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new AppError("Empty response from OpenAI", 500);
      }

      const response: OpenAICompletionResponse = {
        content: responseContent,
        usage: completion.usage
          ? {
              prompt_tokens: completion.usage.prompt_tokens,
              completion_tokens: completion.usage.completion_tokens,
              total_tokens: completion.usage.total_tokens,
            }
          : undefined,
        trim: function (): string | undefined {
          throw new Error("Function not implemented.");
        },
      };

      logger.info("OpenAI completion generated successfully", {
        model: request.model || config.openai.model,
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
      });

      return { success: true, data: response };
    } catch (error: unknown) {
      logger.error("OpenAI completion generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        model: request.model || config.openai.model,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      });

      if (error instanceof AppError) {
        throw error;
      }

      // Handle OpenAI specific errors
      if (error instanceof OpenAI.APIError) {
        if (error.code === "insufficient_quota") {
          throw new AppError("AI service quota exceeded", 503);
        }
        if (error.code === "rate_limit_exceeded") {
          throw new AppError("AI service rate limit exceeded", 429);
        }
        if (error.code === "context_length_exceeded") {
          throw new AppError("Content too long for AI processing", 413);
        }
      }

      throw new AppError("OpenAI completion generation failed", 500);
    }
  }
}

export const openaiService = new OpenAIService();
