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
                "You are a helpful assistant that creates concise summaries and extracts key points from transcripts.",
            },
            {
              role: "user",
              content: `Generate a very very detailed note of all the key points mentioned in this transcript. From that generate the top 3 key takeaways, top 3 memorable quotes, top 3 examples. Present the final output starting with the top 3 key takeaways, top 3 memorable quotes, top 3 examples followed by the detailed note of all the key points.
                    Transcript: ${transcriptText}`,
            },
          ],
          reasoning_effort: "minimal",
          verbosity: "high",
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
        } catch (trackingError) {
          // Continue operation even if tracking fails
          logger.warn("Failed to track OpenAI usage", {
            trackingError,
            userId,
          });
        }
      }

      // Parse the response text to extract structured data
      const summaryData = this.parseNewFormatResponse(responseText);

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

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        try {
          const chunkText = this.formatTranscriptForAI(chunks[i]);
          const chunkPrompt = this.createChunkSummaryPrompt(
            chunkText,
            i + 1,
            chunks.length
          );

          logger.info("Processing chunk", {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            chunkLength: chunkText.length,
          });

          const completion = await this.client.chat.completions.create({
            model: config.openai.model,
            messages: [
              {
                role: "system",
                content:
                  "You are an AI assistant that creates concise summaries of video transcript chunks.",
              },
              {
                role: "user",
                content: chunkPrompt,
              },
            ],
            max_tokens: 500,
            temperature: 0.3,
          });

          // Track usage for chunk processing
          if (userId && completion.usage) {
            try {
              await this.trackUsage(
                userId,
                "chunk_summary",
                config.openai.model,
                completion.usage,
                videoMetadata.videoId
              );
            } catch (trackingError) {
              logger.warn("Failed to track chunk usage", {
                trackingError,
                userId,
              });
            }
          }

          const chunkSummary = completion.choices[0]?.message?.content;
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

      // Combine chunk summaries into final summary
      const combinedSummary = chunkSummaries.join("\n\n");
      const finalPrompt = this.createFinalSummaryPrompt(
        combinedSummary,
        videoMetadata
      );

      const finalCompletion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant that creates final summaries from multiple text chunks, extracting key points and themes.",
          },
          {
            role: "user",
            content: finalPrompt,
          },
        ],
        max_tokens: config.openai.maxTokens,
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      // Track usage for final summary
      if (userId && finalCompletion.usage) {
        try {
          await this.trackUsage(
            userId,
            "final_summary",
            config.openai.model,
            finalCompletion.usage,
            videoMetadata.videoId
          );
        } catch (trackingError) {
          logger.warn("Failed to track final summary usage", {
            trackingError,
            userId,
          });
        }
      }

      const finalResponseText = finalCompletion.choices[0]?.message?.content;
      if (!finalResponseText) {
        throw new AppError("Empty response from OpenAI", 500);
      }

      const summaryData: OpenAISummaryResponse = JSON.parse(finalResponseText);

      if (!this.validateSummaryResponse(summaryData)) {
        throw new AppError("Invalid summary response structure", 500);
      }

      // Add usage information to response
      if (finalCompletion.usage) {
        summaryData.usage = {
          promptTokens: finalCompletion.usage.prompt_tokens,
          completionTokens: finalCompletion.usage.completion_tokens,
          totalTokens: finalCompletion.usage.total_tokens,
        };
      }

      logger.info("Chunked summary generated successfully", {
        videoId: videoMetadata.videoId,
        chunksProcessed: chunks.length,
        keyPointsCount: summaryData.keyPoints.length,
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

  // Create main summary prompt
  private createSummaryPrompt(
    transcriptText: string,
    videoMetadata: VideoMetadata
  ): string {
    return `Generate a very very detailed note of all the key points mentioned in this transcript. From that generate the top 3 key takeaways, top 3 memorable quotes, top 3 examples. Present the final output starting with the top 3 key takeaways, top 3 memorable quotes, top 3 examples followed by the detailed note of all the key points.
                    Transcript: ${transcriptText}`;
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
  private parseNewFormatResponse(responseText: string): OpenAISummaryResponse {
    // Extract key takeaways, quotes, examples, and detailed notes from the response
    const lines = responseText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const keyPoints: string[] = [];
    const quotes: string[] = [];
    const examples: string[] = [];
    let detailedNotes = "";

    let currentSection = "";
    let inDetailedNotes = false;

    for (const line of lines) {
      if (
        line.toLowerCase().includes("key takeaways") ||
        line.toLowerCase().includes("takeaway")
      ) {
        currentSection = "takeaways";
        continue;
      } else if (
        line.toLowerCase().includes("memorable quotes") ||
        line.toLowerCase().includes("quote")
      ) {
        currentSection = "quotes";
        continue;
      } else if (
        line.toLowerCase().includes("examples") ||
        line.toLowerCase().includes("example")
      ) {
        currentSection = "examples";
        continue;
      } else if (
        line.toLowerCase().includes("detailed note") ||
        line.toLowerCase().includes("detailed notes")
      ) {
        currentSection = "detailed";
        inDetailedNotes = true;
        continue;
      }

      if (inDetailedNotes) {
        detailedNotes += line + "\n";
      } else if (currentSection === "takeaways" && line.match(/^\d+\./)) {
        keyPoints.push(line.replace(/^\d+\.\s*/, ""));
      } else if (currentSection === "quotes" && line.match(/^\d+\./)) {
        quotes.push(line.replace(/^\d+\.\s*/, ""));
      } else if (currentSection === "examples" && line.match(/^\d+\./)) {
        examples.push(line.replace(/^\d+\.\s*/, ""));
      }
    }

    // Generate tags from the content
    const allText = responseText.toLowerCase();
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
      keyPoints:
        keyPoints.length > 0
          ? keyPoints
          : ["Key insights extracted from the video"],
      fullSummary:
        detailedNotes.trim() || "Detailed summary of the video content",
      tags: tags.slice(0, 5), // Limit to 5 tags
    };
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
