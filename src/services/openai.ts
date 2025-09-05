import OpenAI from "openai";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
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

  // Generate summary from transcript
  async generateSummary(
    transcript: TranscriptSegment[],
    videoMetadata: VideoMetadata
  ): Promise<ServiceResponse<OpenAISummaryResponse>> {
    try {
      const transcriptText = this.formatTranscriptForAI(transcript);

      if (transcriptText.length > MAX_TRANSCRIPT_LENGTH) {
        // Chunk large transcripts
        return this.generateSummaryFromChunks(transcript, videoMetadata);
      }

      const prompt = this.createSummaryPrompt(transcriptText, videoMetadata);

      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant specialized in creating concise, insightful summaries of YouTube videos. You extract key points, themes, and actionable insights from video transcripts.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: config.openai.maxTokens,
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        throw new AppError("Empty response from OpenAI", 500);
      }

      let summaryData: OpenAISummaryResponse;
      try {
        summaryData = JSON.parse(responseText);
      } catch (parseError) {
        logger.error("Failed to parse OpenAI response", {
          responseText,
          parseError,
        });
        throw new AppError("Invalid response format from AI", 500);
      }

      // Validate response structure
      if (!this.validateSummaryResponse(summaryData)) {
        throw new AppError("Invalid summary response structure", 500);
      }

      logger.info("Summary generated successfully", {
        videoId: videoMetadata.videoId,
        keyPointsCount: summaryData.keyPoints.length,
        tagsCount: summaryData.tags.length,
        transcriptLength: transcriptText.length,
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

      // Handle OpenAI specific errors
      if (
        error instanceof OpenAI.APIError &&
        error.code === "insufficient_quota"
      ) {
        throw new AppError("AI service quota exceeded", 503);
      }

      if (
        error instanceof OpenAI.APIError &&
        error.code === "rate_limit_exceeded"
      ) {
        throw new AppError("AI service rate limit exceeded", 429);
      }

      throw new AppError("Summary generation failed", 500);
    }
  }

  // Handle large transcripts by chunking
  private async generateSummaryFromChunks(
    transcript: TranscriptSegment[],
    videoMetadata: VideoMetadata
  ): Promise<ServiceResponse<OpenAISummaryResponse>> {
    try {
      const chunks = this.chunkTranscript(transcript);
      const chunkSummaries: string[] = [];

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = this.formatTranscriptForAI(chunks[i]);
        const chunkPrompt = this.createChunkSummaryPrompt(
          chunkText,
          i + 1,
          chunks.length
        );

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

        const chunkSummary = completion.choices[0]?.message?.content;
        if (chunkSummary) {
          chunkSummaries.push(chunkSummary);
        }

        // Add delay to avoid rate limiting
        if (i < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
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

      const finalResponseText = finalCompletion.choices[0]?.message?.content;
      if (!finalResponseText) {
        throw new AppError("Empty response from OpenAI", 500);
      }

      const summaryData: OpenAISummaryResponse = JSON.parse(finalResponseText);

      if (!this.validateSummaryResponse(summaryData)) {
        throw new AppError("Invalid summary response structure", 500);
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
    return `
Please analyze this YouTube video transcript and create a comprehensive summary.

Video Title: "${videoMetadata.title}"
Channel: ${videoMetadata.channelName}
Duration: ${videoMetadata.duration || "Unknown"}

Transcript:
${transcriptText}

Please provide a JSON response with the following structure:
{
  "keyPoints": [
    "First key insight or main point (be specific and actionable)",
    "Second key insight or main point",
    "Third key insight or main point",
    "Fourth key insight or main point (if applicable)",
    "Fifth key insight or main point (if applicable)"
  ],
  "fullSummary": "A comprehensive 2-3 paragraph summary that captures the essence, main arguments, and conclusions of the video. Focus on what viewers would find most valuable and actionable.",
  "tags": [
    "relevant-topic-1",
    "relevant-topic-2",
    "relevant-topic-3",
    "relevant-topic-4",
    "relevant-topic-5"
  ]
}

Guidelines:
- Extract 3-5 key points that represent the most important insights
- Key points should be specific, actionable, and valuable to the viewer
- Full summary should be comprehensive but concise (200-400 words)
- Tags should be relevant keywords that categorize the content
- Focus on practical value and main takeaways
- Maintain the original meaning while making it more accessible
`.trim();
  }

  // Create chunk summary prompt
  private createChunkSummaryPrompt(
    chunkText: string,
    chunkNumber: number,
    totalChunks: number
  ): string {
    return `
This is chunk ${chunkNumber} of ${totalChunks} from a YouTube video transcript.

Transcript Chunk:
${chunkText}

Please provide a concise summary of the key points and important information in this chunk. Focus on:
- Main ideas and concepts discussed
- Important details or insights
- Any conclusions or recommendations

Keep the summary to 2-3 sentences maximum.
`.trim();
  }

  // Create final summary prompt for chunked content
  private createFinalSummaryPrompt(
    combinedSummary: string,
    videoMetadata: VideoMetadata
  ): string {
    return `
Please create a comprehensive summary from these chunk summaries of a YouTube video.

Video Title: "${videoMetadata.title}"
Channel: ${videoMetadata.channelName}

Chunk Summaries:
${combinedSummary}

Please provide a JSON response with the following structure:
{
  "keyPoints": [
    "First key insight or main point",
    "Second key insight or main point",
    "Third key insight or main point",
    "Fourth key insight or main point (if applicable)",
    "Fifth key insight or main point (if applicable)"
  ],
  "fullSummary": "A comprehensive summary that synthesizes all the chunk summaries into a coherent overview of the entire video",
  "tags": [
    "relevant-topic-1",
    "relevant-topic-2",
    "relevant-topic-3",
    "relevant-topic-4",
    "relevant-topic-5"
  ]
}

Guidelines:
- Synthesize the chunk summaries into 3-5 key points
- Create a comprehensive full summary that covers the entire video
- Include relevant tags for categorization
- Focus on the most valuable insights and takeaways
`.trim();
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
        }
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
