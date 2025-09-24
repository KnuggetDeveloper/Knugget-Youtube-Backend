import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "../config/database";
import { config } from "../config";
import { AuthenticatedRequest, JwtPayload, ApiResponse } from "../types";
import { logger } from "../config/logger";

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

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

    let payload: JwtPayload;
    let user;

    try {
      // FIXED: Primary JWT verification (cleaner approach)
      payload = jwt.verify(token, config.jwt.secret) as JwtPayload;

      user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          credits: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          supabaseId: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }
    } catch (jwtError) {
      // FIXED: Fallback to Supabase only if JWT fails
      try {
        const { data: supabaseUser, error: supabaseError } =
          await supabase.auth.getUser(token);

        if (supabaseError || !supabaseUser.user) {
          throw new Error("Invalid token");
        }

        // Find user by Supabase ID
        user = await prisma.user.findUnique({
          where: { supabaseId: supabaseUser.user.id },
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            plan: true,
            credits: true,
            subscriptionId: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            lastLoginAt: true,
            supabaseId: true,
          },
        });

        // Create user if doesn't exist (first-time Supabase login)
        if (!user && supabaseUser.user.email) {
          user = await prisma.user.create({
            data: {
              email: supabaseUser.user.email,
              name: supabaseUser.user.user_metadata?.name || null,
              avatar: supabaseUser.user.user_metadata?.avatar_url || null,
              plan: "FREE",
              credits: 3,
              subscriptionId: null,
              supabaseId: supabaseUser.user.id,
              emailVerified: !!supabaseUser.user.email_confirmed_at,
              lastLoginAt: new Date(),
            },
            select: {
              id: true,
              email: true,
              name: true,
              avatar: true,
              plan: true,
              credits: true,
              subscriptionId: true,
              emailVerified: true,
              createdAt: true,
              updatedAt: true,
              lastLoginAt: true,
              supabaseId: true,
            },
          });
        }

        if (!user) {
          throw new Error("User not found");
        }
      } catch (supabaseError) {
        logger.error("Token verification failed", {
          error: supabaseError,
          hasJWTError: !!jwtError,
          userAgent: req.get("User-Agent"),
          origin: req.get("Origin"),
        });

        const response: ApiResponse = {
          success: false,
          error: "Invalid or expired token",
        };
        res.status(401).json(response);
        return;
      }
    }

    // FIXED: Format user data consistently
    req.user = {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
    };

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

export const requirePlan = (requiredPlan: "FREE" | "PREMIUM") => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "Authentication required",
      };
      res.status(401).json(response);
      return;
    }

    if (requiredPlan === "PREMIUM" && req.user.plan !== "PREMIUM") {
      const response: ApiResponse = {
        success: false,
        error: "Premium plan required",
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
};

export const requireCredits = (requiredCredits: number = 1) => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "Authentication required",
      };
      res.status(401).json(response);
      return;
    }

    if (req.user.credits < requiredCredits) {
      const response: ApiResponse = {
        success: false,
        error: "Insufficient credits",
      };
      res.status(402).json(response);
      return;
    }

    next();
  };
};
