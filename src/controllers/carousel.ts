import { Response } from "express";
import { carouselService } from "../services/carousel";
import { AuthenticatedRequest, ApiResponse } from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

class CarouselController {
  /**
   * Generate carousel slides from transcript
   * POST /api/carousel/generate
   */
  generateCarousel = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, error: "Unauthorized" });
      }

      const userId = req.user.id;
      const { summaryId, transcriptText } = req.body;

      if (!summaryId) {
        return res
          .status(400)
          .json({ success: false, error: "Summary ID is required" });
      }

      logger.info("Carousel generation request received", {
        userId,
        summaryId,
      });

      const result = await carouselService.generateCarousel(userId, {
        summaryId,
        transcriptText,
      });

      const response: ApiResponse = {
        success: true,
        data: result.data,
        message: "Carousel generated successfully",
      };

      res.status(200).json(response);
    },
    2147483647 // Effectively no timeout (max 32-bit signed integer)
  );

  /**
   * Get existing carousel slides for a summary
   * GET /api/carousel/:summaryId
   */
  getCarouselSlides = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized" });
    }

    const userId = req.user.id;
    const { summaryId } = req.params;

    if (!summaryId) {
      return res
        .status(400)
        .json({ success: false, error: "Summary ID is required" });
    }

    const result = await carouselService.getCarouselSlides(userId, summaryId);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: result.data ? "Carousel slides fetched successfully" : "No carousel found",
    };

    res.status(200).json(response);
  });
}

export const carouselController = new CarouselController();

