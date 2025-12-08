// src/controllers/website.ts
import { Response } from "express";
import { websiteSummaryService } from "../services/website";
import {
  AuthenticatedRequest,
  ApiResponse,
  CreateWebsiteSummaryDto,
} from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

export class WebsiteSummaryController {
  // Create or get website summary
  createSummary = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const summaryData: CreateWebsiteSummaryDto = req.body;

      // Validate required fields
      if (!summaryData.title || !summaryData.content || !summaryData.url) {
        const response: ApiResponse = {
          success: false,
          error: "Missing required fields: title, content, and url are required",
        };
        return res.status(400).json(response);
      }

      // Validate URL format
      try {
        new URL(summaryData.url);
      } catch (error) {
        const response: ApiResponse = {
          success: false,
          error: "Invalid URL format",
        };
        return res.status(400).json(response);
      }

      // Validate content length (prevent abuse)
      if (summaryData.content.length > 100000) {
        // 100KB limit
        const response: ApiResponse = {
          success: false,
          error: "Content too long. Maximum 100,000 characters allowed.",
        };
        return res.status(400).json(response);
      }

      if (summaryData.content.length < 100) {
        // Minimum content length
        const response: ApiResponse = {
          success: false,
          error:
            "Content too short. Minimum 100 characters required for meaningful summarization.",
        };
        return res.status(400).json(response);
      }

      const result = await websiteSummaryService.createOrGetSummary(
        req.user.id,
        summaryData
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
        message: result.data?.isNew
          ? "Website summary created successfully"
          : "Website summary retrieved from existing data",
      };

      logger.info("Website summary request processed", {
        userId: req.user.id,
        url: summaryData.url,
        title: summaryData.title,
        isNew: result.data?.isNew,
        summaryId: result.data?.id,
      });

      // Return appropriate status code
      res.status(result.data?.isNew ? 201 : 200).json(response);
    }
  );

  // Get existing summary by URL
  getSummaryByUrl = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const { url } = req.query;

      if (!url || typeof url !== "string") {
        const response: ApiResponse = {
          success: false,
          error: "URL query parameter is required",
        };
        return res.status(400).json(response);
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        const response: ApiResponse = {
          success: false,
          error: "Invalid URL format",
        };
        return res.status(400).json(response);
      }

      const result = await websiteSummaryService.getSummaryByUrl(
        req.user.id,
        url
      );

      if (!result.data) {
        const response: ApiResponse = {
          success: false,
          error: "No summary found for this URL",
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      logger.info("Website summary retrieved", {
        userId: req.user.id,
        url,
        summaryId: result.data.id,
      });

      res.json(response);
    }
  );

  // Health check for website summary functionality
  healthCheck = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      const response: ApiResponse = {
        success: true,
        data: {
          service: "Website Summary API",
          status: "healthy",
          timestamp: new Date().toISOString(),
          features: [
            "Article content summarization",
            "Duplicate prevention",
            "Website name extraction",
            "Favicon URL generation",
          ],
        },
      };

      res.json(response);
    }
  );
}

export const websiteSummaryController = new WebsiteSummaryController();

