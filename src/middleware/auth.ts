import { Request, Response, NextFunction } from "express";
import { firebaseAuth } from "../config/firebase";
import { authService } from "../services/auth";
import { AuthenticatedRequest, ApiResponse } from "../types";
import { logger } from "../config/logger";

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      const response: ApiResponse = {
        success: false,
        error: "Authorization token required",
      };
      res.status(401).json(response);
      return;
    }

    // Verify Firebase ID token
    const decodedToken = await firebaseAuth.verifyIdToken(token);

    if (!decodedToken.uid) {
      const response: ApiResponse = {
        success: false,
        error: "Invalid token",
      };
      res.status(401).json(response);
      return;
    }

    // Sync user from Firebase token (creates user if doesn't exist)
    const userResult = await authService.syncUserFromToken(token);

    if (!userResult.success || !userResult.data) {
      const response: ApiResponse = {
        success: false,
        error: "User not found",
      };
      res.status(401).json(response);
      return;
    }

    // Attach user to request
    req.user = userResult.data;

    next();
  } catch (error) {
    logger.error("Authentication middleware error", {
      error,
      userAgent: req.get("User-Agent"),
      origin: req.get("Origin"),
    });

    const response: ApiResponse = {
      success: false,
      error: "Authentication failed",
    };
    res.status(401).json(response);
    return;
  }
};

export const requirePlan =
  (requiredPlan: "FREE" | "PREMIUM") =>
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "Authentication required",
        };
        res.status(401).json(response);
        return;
      }

      // Check if user has required plan
      if (requiredPlan === "PREMIUM" && req.user.plan !== "PREMIUM") {
        const response: ApiResponse = {
          success: false,
          error: "Premium plan required",
        };
        res.status(403).json(response);
        return;
      }

      next();
    } catch (error) {
      logger.error("Plan validation error", { error, userId: req.user?.id });
      const response: ApiResponse = {
        success: false,
        error: "Plan validation failed",
      };
      res.status(500).json(response);
      return;
    }
  };

export const requireCredits =
  (requiredCredits: number = 1) =>
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "Authentication required",
        };
        res.status(401).json(response);
        return;
      }

      // Check if user has enough credits
      if (req.user.credits < requiredCredits) {
        const response: ApiResponse = {
          success: false,
          error: "Insufficient credits",
        };
        res.status(403).json(response);
        return;
      }

      next();
    } catch (error) {
      logger.error("Credits validation error", { error, userId: req.user?.id });
      const response: ApiResponse = {
        success: false,
        error: "Credits validation failed",
      };
      res.status(500).json(response);
      return;
    }
  };
