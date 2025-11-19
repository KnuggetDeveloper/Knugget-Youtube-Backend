import { UserPlan } from "@prisma/client";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  UserProfile,
  UserStats,
  ServiceResponse,
  UpdateUserData,
} from "../types";
import { tokenService } from "./token";

export class UserService {
  // Get user profile
  async getUserProfile(userId: string): Promise<ServiceResponse<UserProfile>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
          videosProcessedThisMonth: true,
          videoResetDate: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      const profile: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        plan: user.plan,
        subscriptionId: user.subscriptionId,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() || null,
        inputTokensRemaining: user.inputTokensRemaining,
        outputTokensRemaining: user.outputTokensRemaining,
        tokenResetDate: user.tokenResetDate?.toISOString() || null,
        videosProcessedThisMonth: user.videosProcessedThisMonth,
        videoResetDate: user.videoResetDate?.toISOString() || null,
      };

      return { success: true, data: profile };
    } catch (error) {
      logger.error("Get user profile failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get user profile", 500);
    }
  }

  // Update user profile
  async updateUserProfile(
    userId: string,
    updates: Partial<Pick<UserProfile, "name" | "avatar">>
  ): Promise<ServiceResponse<UserProfile>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.avatar !== undefined && { avatar: updates.avatar }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      const profile: UserProfile = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        avatar: updatedUser.avatar,
        plan: updatedUser.plan,
        subscriptionId: updatedUser.subscriptionId,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt.toISOString(),
        lastLoginAt: updatedUser.lastLoginAt?.toISOString() || null,
      };

      logger.info("User profile updated", {
        userId,
        updates: Object.keys(updates),
      });

      return { success: true, data: profile };
    } catch (error) {
      logger.error("Update user profile failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        updates,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to update user profile", 500);
    }
  }

  // Get user statistics
  async getUserStats(userId: string): Promise<ServiceResponse<UserStats>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          videosProcessedThisMonth: true,
          videoResetDate: true,
          createdAt: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
          _count: {
            select: {
              summaries: true,
            },
          },
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Get summaries this month for all content types
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get summaries this month - only YouTube summaries active
      const summariesThisMonth = await prisma.summary.count({
        where: {
          userId,
          createdAt: { gte: startOfMonth },
          status: "COMPLETED",
        },
      });

      // Get video limit based on plan
      let videoLimit: number;
      switch (user.plan) {
        case "FREE":
          videoLimit = config.videoLimits.free;
          break;
        case "LITE":
          videoLimit = config.videoLimits.lite;
          break;
        case "PRO":
          videoLimit = config.videoLimits.pro;
          break;
        default:
          videoLimit = config.videoLimits.free;
      }

      const videosProcessed = user.videosProcessedThisMonth || 0;

      // Get OpenAI usage statistics (with fallback for backward compatibility)
      let openaiUsageStats = {
        _sum: {
          promptTokens: null as number | null,
          completionTokens: null as number | null,
          totalTokens: null as number | null,
        },
      };

      try {
        openaiUsageStats = await prisma.openAIUsage.aggregate({
          where: { userId },
          _sum: {
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
          },
        });
      } catch (error) {
        // Handle case where OpenAI usage table doesn't exist yet during migration
        logger.warn("OpenAI usage table not accessible, using defaults", {
          userId,
        });
      }

      const stats: UserStats = {
        totalSummaries: user._count?.summaries || 0,
        summariesThisMonth,
        videosProcessed,
        videoLimit,
        videosRemaining: Math.max(0, videoLimit - videosProcessed),
        planStatus: user.plan,
        joinedDate: user.createdAt.toISOString(),
        // OpenAI Usage stats
        totalInputTokens: openaiUsageStats._sum.promptTokens ?? 0,
        totalOutputTokens: openaiUsageStats._sum.completionTokens ?? 0,
        totalTokens: openaiUsageStats._sum.totalTokens ?? 0,
        // Token limits per plan
        inputTokensRemaining: user.inputTokensRemaining,
        outputTokensRemaining: user.outputTokensRemaining,
        tokenResetDate: user.tokenResetDate?.toISOString() || null,
      };

      return { success: true, data: stats };
    } catch (error) {
      logger.error("Get user stats failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get user statistics", 500);
    }
  }

  // DEPRECATED: Credits system removed - using video limits now
  // These methods kept for backward compatibility but do nothing
  async addCredits(
    userId: string,
    credits: number
  ): Promise<ServiceResponse<{ newBalance: number }>> {
    logger.warn("addCredits called but credits system is deprecated", {
      userId,
    });
    return { success: true, data: { newBalance: 0 } };
  }

  async deductCredits(
    userId: string,
    credits: number
  ): Promise<ServiceResponse<{ newBalance: number }>> {
    logger.warn("deductCredits called but credits system is deprecated", {
      userId,
    });
    return { success: true, data: { newBalance: 0 } };
  }

  // Upgrade user plan (now initializes tokens for the new plan)
  async upgradePlan(
    userId: string,
    newPlan: UserPlan
  ): Promise<ServiceResponse<UserProfile>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.plan === newPlan) {
        throw new AppError(`User is already on ${newPlan} plan`, 400);
      }

      // Update plan
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          plan: newPlan,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      // Initialize tokens for the new plan
      await tokenService.initializePlanTokens(userId, newPlan);

      const profile: UserProfile = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        avatar: updatedUser.avatar,
        plan: updatedUser.plan,
        subscriptionId: updatedUser.subscriptionId,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt.toISOString(),
        lastLoginAt: updatedUser.lastLoginAt?.toISOString() || null,
      };

      logger.info("User plan upgraded", {
        userId,
        oldPlan: user.plan,
        newPlan,
      });

      return { success: true, data: profile };
    } catch (error) {
      logger.error("Plan upgrade failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        newPlan,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to upgrade plan", 500);
    }
  }

  // Reset monthly videos and tokens (should be called by a cron job)
  async resetMonthlyCredits(): Promise<
    ServiceResponse<{ usersUpdated: number; tokensReset: number }>
  > {
    try {
      // Reset video counts for all users
      const videoResetResult = await prisma.user.updateMany({
        data: { videosProcessedThisMonth: 0 },
      });

      // Reset tokens for paid users (LITE and PRO)
      const tokenResetResult = await tokenService.resetAllPremiumTokens();
      const tokensReset = tokenResetResult.success
        ? tokenResetResult.data?.usersUpdated || 0
        : 0;

      logger.info("Monthly videos and tokens reset", {
        videosReset: videoResetResult.count,
        tokensReset,
      });

      return {
        success: true,
        data: { usersUpdated: videoResetResult.count, tokensReset },
      };
    } catch (error) {
      logger.error("Monthly reset failed", { error });
      throw new AppError("Failed to reset monthly limits", 500);
    }
  }

  // Delete user account
  async deleteUser(userId: string): Promise<ServiceResponse<void>> {
    try {
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Delete user and all related data (cascading delete)
      await prisma.user.delete({
        where: { id: userId },
      });

      logger.info("User account deleted", {
        userId,
        email: user.email,
      });

      return { success: true };
    } catch (error) {
      logger.error("Delete user failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to delete user account", 500);
    }
  }

  // Get user by email (admin function)
  async getUserByEmail(
    email: string
  ): Promise<ServiceResponse<UserProfile | null>> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
          videosProcessedThisMonth: true,
          videoResetDate: true,
        },
      });

      if (!user) {
        return { success: true, data: null };
      }

      const profile: UserProfile = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        plan: user.plan,
        subscriptionId: user.subscriptionId,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() || null,
        inputTokensRemaining: user.inputTokensRemaining,
        outputTokensRemaining: user.outputTokensRemaining,
        tokenResetDate: user.tokenResetDate?.toISOString() || null,
        videosProcessedThisMonth: user.videosProcessedThisMonth,
        videoResetDate: user.videoResetDate?.toISOString() || null,
      };

      return { success: true, data: profile };
    } catch (error) {
      logger.error("Get user by email failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        email,
      });
      throw new AppError("Failed to get user", 500);
    }
  }

  // Verify user email
  async verifyEmail(userId: string): Promise<ServiceResponse<void>> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });

      logger.info("User email verified", { userId });

      return { success: true };
    } catch (error) {
      logger.error("Email verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to verify email", 500);
    }
  }
}

export const userService = new UserService();
