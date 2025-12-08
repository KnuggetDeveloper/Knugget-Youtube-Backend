// src/services/website.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { openaiService } from "./openai";
import {
  CreateWebsiteSummaryDto,
  WebsiteSummaryResponse,
  ServiceResponse,
  WebsiteSummaryData,
} from "../types";

export class WebsiteSummaryService {
  // Create or get existing website summary
  async createOrGetSummary(
    userId: string,
    data: CreateWebsiteSummaryDto
  ): Promise<ServiceResponse<WebsiteSummaryResponse>> {
    try {
      // Check if summary already exists for this URL and user
      const existingSummary = await prisma.websiteSummary.findFirst({
        where: {
          userId,
          url: data.url,
        },
      });

      if (existingSummary) {
        logger.info("Website summary already exists, returning existing", {
          userId,
          url: data.url,
          summaryId: existingSummary.id,
        });

        return {
          success: true,
          data: {
            ...this.formatSummary(existingSummary),
            isNew: false,
          },
        };
      }

      // Generate summary using OpenAI
      const summaryResult = await this.generateSummary(data.content);
      if (!summaryResult.success || !summaryResult.data) {
        throw new AppError("Failed to generate summary", 500);
      }

      // Extract website name from URL
      const websiteName = this.extractWebsiteName(data.url);

      // Get favicon URL
      const faviconUrl = this.getFaviconUrl(data.url);

      // Create new website summary
      const websiteSummary = await prisma.websiteSummary.create({
        data: {
          title: data.title,
          content: data.content,
          summary: summaryResult.data,
          url: data.url,
          websiteName,
          faviconUrl,
          userId,
        },
      });

      logger.info("Website summary created successfully", {
        userId,
        summaryId: websiteSummary.id,
        url: data.url,
        websiteName,
        titleLength: data.title.length,
        contentLength: data.content.length,
        summaryLength: summaryResult.data.length,
      });

      return {
        success: true,
        data: {
          ...this.formatSummary(websiteSummary),
          isNew: true,
        },
      };
    } catch (error) {
      logger.error("Website summary creation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url: data.url,
        title: data.title,
        contentLength: data.content.length,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to create website summary", 500);
    }
  }

  // Get existing summary by URL
  async getSummaryByUrl(
    userId: string,
    url: string
  ): Promise<ServiceResponse<WebsiteSummaryResponse | null>> {
    try {
      const summary = await prisma.websiteSummary.findFirst({
        where: {
          userId,
          url,
        },
      });

      if (!summary) {
        return {
          success: true,
          data: null,
        };
      }

      return {
        success: true,
        data: {
          ...this.formatSummary(summary),
          isNew: false,
        },
      };
    } catch (error) {
      logger.error("Get website summary by URL failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        url,
      });
      throw new AppError("Failed to get website summary", 500);
    }
  }

  // Generate summary using OpenAI
  private async generateSummary(
    content: string
  ): Promise<ServiceResponse<string>> {
    try {
      // Optimal prompt for website article summarization
      const prompt = `Please provide a comprehensive yet concise summary of the following article. Focus on:
- Key points and main arguments
- Important insights or conclusions
- Practical takeaways for the reader
- Maintain the author's tone and perspective

Keep the summary informative but readable, around 2-3 paragraphs.

Article content:
${content}`;

      const response = await openaiService.generateCompletion({
        messages: [
          {
            role: "system",
            content:
              "You are an expert at summarizing articles. Create clear, engaging summaries that capture the essence and key insights of the content.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        maxTokens: 500, // Appropriate length for article summaries
        temperature: 0.3, // Lower temperature for more consistent summaries
      });

      if (!response.success || !response.data) {
        throw new AppError("OpenAI summary generation failed", 500);
      }

      return {
        success: true,
        data: response.data.content.trim(),
      };
    } catch (error) {
      logger.error("OpenAI summary generation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        contentLength: content.length,
      });
      throw new AppError("Failed to generate article summary", 500);
    }
  }

  // Extract website name from URL
  private extractWebsiteName(url: string): string {
    try {
      const domain = new URL(url).hostname.replace("www.", "");

      // Common website name mappings
      const websiteNames: Record<string, string> = {
        "medium.com": "Medium",
        "dev.to": "Dev.to",
        "substack.com": "Substack",
        "hashnode.com": "Hashnode",
        "hackernoon.com": "HackerNoon",
        "freecodecamp.org": "freeCodeCamp",
        "towardsdatascience.com": "Towards Data Science",
        "css-tricks.com": "CSS-Tricks",
        "smashingmagazine.com": "Smashing Magazine",
        "a16z.com": "Andreessen Horowitz",
        "techcrunch.com": "TechCrunch",
        "wired.com": "Wired",
        "theverge.com": "The Verge",
        "github.com": "GitHub",
        "stackoverflow.com": "Stack Overflow",
        "reddit.com": "Reddit",
      };

      // Check for exact matches first
      if (websiteNames[domain]) {
        return websiteNames[domain];
      }

      // Check for subdomain matches (e.g., user.substack.com)
      for (const [key, value] of Object.entries(websiteNames)) {
        if (domain.endsWith(key)) {
          return value;
        }
      }

      // Default: capitalize first letter of domain name
      const siteName = domain.split(".")[0];
      return siteName.charAt(0).toUpperCase() + siteName.slice(1);
    } catch (error) {
      logger.warn("Failed to extract website name", { url, error });
      return "Unknown";
    }
  }

  // Get favicon URL for the website
  private getFaviconUrl(url: string): string {
    try {
      const domain = new URL(url).origin;
      return `${domain}/favicon.ico`;
    } catch (error) {
      logger.warn("Failed to get favicon URL", { url, error });
      return `https://www.google.com/s2/favicons?domain=${url}`;
    }
  }

  // Format website summary for API response
  private formatSummary(summary: any): WebsiteSummaryData {
    return {
      id: summary.id,
      title: summary.title,
      content: summary.content,
      summary: summary.summary,
      url: summary.url,
      websiteName: summary.websiteName,
      faviconUrl: summary.faviconUrl,
      createdAt: summary.createdAt.toISOString(),
      updatedAt: summary.updatedAt.toISOString(),
    };
  }
}

export const websiteSummaryService = new WebsiteSummaryService();
