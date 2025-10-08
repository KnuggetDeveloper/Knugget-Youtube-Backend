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
          credits: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
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
        credits: user.credits,
        subscriptionId: user.subscriptionId,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() || null,
        inputTokensRemaining: user.inputTokensRemaining,
        outputTokensRemaining: user.outputTokensRemaining,
        tokenResetDate: user.tokenResetDate?.toISOString() || null,
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
          credits: true,
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
        credits: updatedUser.credits,
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
          credits: true,
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

      // Calculate credits used (assuming user started with max credits)
      const maxCredits =
        user.plan === "PREMIUM"
          ? config.credits.premiumMonthly
          : config.credits.freeMonthly;

      const creditsUsed = Math.max(0, maxCredits - user.credits);

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
        totalSummaries: user._count.summaries,
        summariesThisMonth,
        creditsUsed,
        creditsRemaining: user.credits,
        planStatus: user.plan,
        joinedDate: user.createdAt.toISOString(),
        // OpenAI Usage stats
        totalInputTokens: openaiUsageStats._sum.promptTokens ?? 0,
        totalOutputTokens: openaiUsageStats._sum.completionTokens ?? 0,
        totalTokens: openaiUsageStats._sum.totalTokens ?? 0,
        // Premium token stats
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

  // Add credits to user account
  async addCredits(
    userId: string,
    credits: number
  ): Promise<ServiceResponse<{ newBalance: number }>> {
    try {
      if (credits <= 0) {
        throw new AppError("Credits must be positive", 400);
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { increment: credits },
        },
        select: { credits: true },
      });

      logger.info("Credits added to user", {
        userId,
        creditsAdded: credits,
        newBalance: updatedUser.credits,
      });

      return {
        success: true,
        data: { newBalance: updatedUser.credits },
      };
    } catch (error) {
      logger.error("Add credits failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        credits,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to add credits", 500);
    }
  }

  // Deduct credits from user account
  async deductCredits(
    userId: string,
    credits: number
  ): Promise<ServiceResponse<{ newBalance: number }>> {
    try {
      if (credits <= 0) {
        throw new AppError("Credits must be positive", 400);
      }

      // Check current balance
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.credits < credits) {
        throw new AppError("Insufficient credits", 402);
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { decrement: credits },
        },
        select: { credits: true },
      });

      logger.info("Credits deducted from user", {
        userId,
        creditsDeducted: credits,
        newBalance: updatedUser.credits,
      });

      return {
        success: true,
        data: { newBalance: updatedUser.credits },
      };
    } catch (error) {
      logger.error("Deduct credits failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        credits,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to deduct credits", 500);
    }
  }

  // Upgrade user plan
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

      // Calculate credits to add based on plan upgrade
      let creditsToAdd = 0;
      if (newPlan === "PREMIUM" && user.plan === "FREE") {
        creditsToAdd =
          config.credits.premiumMonthly - config.credits.freeMonthly;
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          plan: newPlan,
          ...(creditsToAdd > 0 && { credits: { increment: creditsToAdd } }),
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
          lastLoginAt: true,
        },
      });

      const profile: UserProfile = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        avatar: updatedUser.avatar,
        plan: updatedUser.plan,
        credits: updatedUser.credits,
        subscriptionId: updatedUser.subscriptionId,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt.toISOString(),
        lastLoginAt: updatedUser.lastLoginAt?.toISOString() || null,
      };

      logger.info("User plan upgraded", {
        userId,
        oldPlan: user.plan,
        newPlan,
        creditsAdded: creditsToAdd,
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

  // Reset monthly credits and tokens (should be called by a cron job)
  async resetMonthlyCredits(): Promise<
    ServiceResponse<{ usersUpdated: number; tokensReset: number }>
  > {
    try {
      // Reset credits for all users based on their plan
      const [freeUsersResult, premiumUsersResult] = await Promise.all([
        prisma.user.updateMany({
          where: { plan: "FREE" },
          data: { credits: config.credits.freeMonthly },
        }),
        prisma.user.updateMany({
          where: { plan: "PREMIUM" },
          data: { credits: config.credits.premiumMonthly },
        }),
      ]);

      const totalUpdated = freeUsersResult.count + premiumUsersResult.count;

      // Reset tokens for premium users
      const tokenResetResult = await tokenService.resetAllPremiumTokens();
      const tokensReset = tokenResetResult.success
        ? tokenResetResult.data?.usersUpdated || 0
        : 0;

      logger.info("Monthly credits and tokens reset", {
        freeUsers: freeUsersResult.count,
        premiumUsers: premiumUsersResult.count,
        totalUsers: totalUpdated,
        tokensReset,
      });

      return {
        success: true,
        data: { usersUpdated: totalUpdated, tokensReset },
      };
    } catch (error) {
      logger.error("Monthly credits reset failed", { error });
      throw new AppError("Failed to reset monthly credits", 500);
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
          credits: true,
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
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
        credits: user.credits,
        subscriptionId: user.subscriptionId,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() || null,
        inputTokensRemaining: user.inputTokensRemaining,
        outputTokensRemaining: user.outputTokensRemaining,
        tokenResetDate: user.tokenResetDate?.toISOString() || null,
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
