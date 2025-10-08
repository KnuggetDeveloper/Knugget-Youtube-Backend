import { Request, Response } from "express";
import { tokenService } from "../services/token";
import { logger } from "../config/logger";
import { AuthenticatedRequest, ApiResponse } from "../types";

class TokenController {
  /**
   * Get token status for authenticated user
   */
  async getTokenStatus(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;

      logger.info("Getting token status", {
        userId: user.id,
      });

      const result = await tokenService.getTokenStatus(user.id);

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        message: "Token status retrieved successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error getting token status", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to get token status",
      } as ApiResponse);
    }
  }

  /**
   * Initialize premium tokens (admin endpoint)
   */
  async initializePremiumTokens(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { billingCycleEndDate } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: "User ID is required",
        } as ApiResponse);
        return;
      }

      logger.info("Initializing premium tokens", {
        userId,
        billingCycleEndDate,
      });

      const endDate = billingCycleEndDate
        ? new Date(billingCycleEndDate)
        : undefined;
      const result = await tokenService.initializePremiumTokens(
        userId,
        endDate
      );

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Premium tokens initialized successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error initializing premium tokens", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to initialize premium tokens",
      } as ApiResponse);
    }
  }

  /**
   * Reset tokens for a user (admin endpoint)
   */
  async resetTokens(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: "User ID is required",
        } as ApiResponse);
        return;
      }

      logger.info("Resetting tokens", {
        userId,
      });

      const result = await tokenService.resetTokens(userId);

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Tokens reset successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error resetting tokens", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to reset tokens",
      } as ApiResponse);
    }
  }

  /**
   * Reset all premium users' tokens (cron job endpoint)
   */
  async resetAllPremiumTokens(req: Request, res: Response): Promise<void> {
    try {
      logger.info("Resetting all premium tokens");

      const result = await tokenService.resetAllPremiumTokens();

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        message: "All premium tokens reset successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error resetting all premium tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to reset all premium tokens",
      } as ApiResponse);
    }
  }

  /**
   * Check token availability (for testing)
   */
  async checkTokenAvailability(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;
      const { inputTokens = 1000, outputTokens = 150 } = req.body;

      logger.info("Checking token availability", {
        userId: user.id,
        inputTokens,
        outputTokens,
      });

      const result = await tokenService.checkTokenAvailability(
        user.id,
        inputTokens,
        outputTokens
      );

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        message: "Token availability checked successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error checking token availability", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to check token availability",
      } as ApiResponse);
    }
  }
}

export const tokenController = new TokenController();
