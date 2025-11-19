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
  (requiredPlan: "FREE" | "LITE" | "PRO") =>
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
      const planHierarchy: Record<string, number> = {
        FREE: 0,
        LITE: 1,
        PRO: 2,
      };

      const userPlanLevel = planHierarchy[req.user.plan] || 0;
      const requiredPlanLevel = planHierarchy[requiredPlan] || 0;

      if (userPlanLevel < requiredPlanLevel) {
        const response: ApiResponse = {
          success: false,
          error: `${requiredPlan} plan or higher required`,
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

// DEPRECATED: Credits system removed - video limits checked in service layer
// This middleware now only checks authentication
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

      // Credits system removed - video limits and tokens checked in service layer
      logger.debug("requireCredits middleware called (deprecated, now only checks auth)", {
        userId: req.user.id,
        plan: req.user.plan,
      });

      next();
    } catch (error) {
      logger.error("Auth validation error", { error, userId: req.user?.id });
      const response: ApiResponse = {
        success: false,
        error: "Auth validation failed",
      };
      res.status(500).json(response);
      return;
    }
  };
