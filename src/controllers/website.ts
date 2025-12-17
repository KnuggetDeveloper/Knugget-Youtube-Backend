import { Response } from "express";
import { websiteSummaryService } from "../services/website";
import {
  AuthenticatedRequest,
  ApiResponse,
  CreateWebsiteSummaryDto,
  WebsiteSummaryQueryParams,
} from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

export class WebsiteSummaryController {
  // Create or get existing website summary
  createOrGetSummary = catchAsync(
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
      if (!summaryData.url || !summaryData.title || !summaryData.content) {
        const response: ApiResponse = {
          success: false,
          error: "Missing required fields: url, title, content",
        };
        return res.status(400).json(response);
      }

      // Validate content length
      if (summaryData.content.length < 100) {
        const response: ApiResponse = {
          success: false,
          error:
            "Content too short. Minimum 100 characters required for meaningful summarization.",
        };
        return res.status(400).json(response);
      }

      if (summaryData.content.length > 100000) {
        const response: ApiResponse = {
          success: false,
          error: "Content too long. Maximum 100,000 characters allowed.",
        };
        return res.status(400).json(response);
      }

      logger.info("Creating website summary", {
        userId: req.user.id,
        url: summaryData.url,
        contentLength: summaryData.content.length,
      });

      const result = await websiteSummaryService.createOrGetArticle(
        req.user.id,
        summaryData
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
        message: "Article saved successfully",
      };

      res.status(201).json(response);
    }
  );

  // Get user's website summaries
  getSummaries = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const queryParams: WebsiteSummaryQueryParams = {
        page: req.query.page
          ? Math.max(1, parseInt(req.query.page as string) || 1)
          : 1,
        limit: req.query.limit
          ? Math.min(
              100,
              Math.max(1, parseInt(req.query.limit as string) || 20)
            )
          : 20,
        search: req.query.search ? String(req.query.search) : undefined,
        startDate: req.query.startDate
          ? String(req.query.startDate)
          : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined,
        sortBy: (req.query.sortBy as any) || "savedAt",
        sortOrder: (req.query.sortOrder as any) || "desc",
      };

      const result = await websiteSummaryService.getArticles(
        req.user.id,
        queryParams
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      res.json(response);
    }
  );

  // Get single summary by ID
  getSummaryById = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const { id } = req.params;

      const result = await websiteSummaryService.getArticleById(
        req.user.id,
        id
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      res.json(response);
    }
  );

  // Get summary by URL
  getSummaryByUrl = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const url = req.query.url as string;

      if (!url) {
        const response: ApiResponse = {
          success: false,
          error: "URL query parameter is required",
        };
        return res.status(400).json(response);
      }

      const result = await websiteSummaryService.getArticleByUrl(
        req.user.id,
        url
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      res.json(response);
    }
  );

  // Delete a website summary
  deleteSummary = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const { id } = req.params;

      await websiteSummaryService.deleteArticle(req.user.id, id);

      const response: ApiResponse = {
        success: true,
        message: "Article deleted successfully",
      };

      logger.info("Article deleted", {
        userId: req.user.id,
        articleId: id,
      });

      res.json(response);
    }
  );

  // Get website summary statistics
  getStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const result = await websiteSummaryService.getStats(req.user.id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Health check for website article saving
  healthCheck = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const response: ApiResponse = {
      success: true,
      data: {
        status: "healthy",
        service: "website-articles",
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  });
}

export const websiteSummaryController = new WebsiteSummaryController();

