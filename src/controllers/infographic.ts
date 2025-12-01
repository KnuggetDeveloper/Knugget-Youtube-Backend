import { Response } from "express";
import { infographicService } from "../services/infographic";
import { AuthenticatedRequest, ApiResponse } from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

export class InfographicController {
  // Generate infographic from summary
  generateInfographic = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const { summaryId, transcriptText } = req.body;

      if (!summaryId) {
        const response: ApiResponse = {
          success: false,
          error: "Missing summaryId",
        };
        return res.status(400).json(response);
      }

      try {
        logger.info("Infographic generation request received", {
          userId: req.user.id,
          summaryId,
        });

        const result = await infographicService.generateInfographic(
          req.user.id,
          {
            summaryId,
            transcriptText,
          }
        );

        const response: ApiResponse = {
          success: true,
          data: result.data,
          message: "Infographic generated successfully",
        };

        logger.info("Infographic generated", {
          userId: req.user.id,
          summaryId,
          imageUrl: result.data?.imageUrl,
        });

        res.json(response);
      } catch (error) {
        logger.error("Infographic generation failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId: req.user.id,
          summaryId,
        });

        const response: ApiResponse = {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate infographic",
        };

        res.status(500).json(response);
      }
    }
    // No timeout - allow as much time as needed for image generation
  );

  // Get image generation statistics
  getStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    try {
      const result = await infographicService.getImageGenerationStats(
        req.user.id
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      res.json(response);
    } catch (error) {
      logger.error("Get infographic stats failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: req.user.id,
      });

      const response: ApiResponse = {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get infographic statistics",
      };

      res.status(500).json(response);
    }
  });

  // Get image generation usage history
  getUsage = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    try {
      const page = req.query.page
        ? Math.max(1, parseInt(req.query.page as string) || 1)
        : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
        : 20;

      const result = await infographicService.getImageGenerationUsage(
        req.user.id,
        page,
        limit
      );

      const response: ApiResponse = {
        success: true,
        data: result.data,
      };

      res.json(response);
    } catch (error) {
      logger.error("Get infographic usage failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: req.user.id,
      });

      const response: ApiResponse = {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get infographic usage",
      };

      res.status(500).json(response);
    }
  });
}

export const infographicController = new InfographicController();
