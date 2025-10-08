import { UserPlan } from "@prisma/client";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { ServiceResponse } from "../types";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TokenStatus {
  inputTokensRemaining: number;
  outputTokensRemaining: number;
  tokenResetDate: Date | null;
  hasEnoughTokens: boolean;
  isTokensExhausted: boolean;
}

export class TokenService {
  /**
   * Initialize premium tokens for a user when they upgrade
   */
  async initializePremiumTokens(
    userId: string,
    billingCycleEndDate?: Date
  ): Promise<ServiceResponse<void>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, nextBillingDate: true },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.plan !== UserPlan.PREMIUM) {
        throw new AppError("User is not on premium plan", 400);
      }

      // Use provided billing cycle end date or next billing date from user
      const tokenResetDate =
        billingCycleEndDate || user.nextBillingDate || this.getNextMonthDate();

      await prisma.user.update({
        where: { id: userId },
        data: {
          inputTokensRemaining: config.tokens.premiumInputTokens,
          outputTokensRemaining: config.tokens.premiumOutputTokens,
          tokenResetDate,
        },
      });

      logger.info("Premium tokens initialized", {
        userId,
        inputTokens: config.tokens.premiumInputTokens,
        outputTokens: config.tokens.premiumOutputTokens,
        tokenResetDate,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to initialize premium tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to initialize premium tokens", 500);
    }
  }

  /**
   * Check if user has enough tokens for a request
   */
  async checkTokenAvailability(
    userId: string,
    requiredInputTokens: number,
    requiredOutputTokens: number
  ): Promise<ServiceResponse<TokenStatus>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Free users don't use token system, they use credits
      if (user.plan === UserPlan.FREE) {
        return {
          success: true,
          data: {
            inputTokensRemaining: 0,
            outputTokensRemaining: 0,
            tokenResetDate: null,
            hasEnoughTokens: true, // Free users use credit system
            isTokensExhausted: false,
          },
        };
      }

      // Check if tokens need to be reset (billing cycle ended)
      const now = new Date();
      if (user.tokenResetDate && user.tokenResetDate <= now) {
        await this.resetTokens(userId);
        // Refresh user data after reset
        const updatedUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            inputTokensRemaining: true,
            outputTokensRemaining: true,
            tokenResetDate: true,
          },
        });

        if (updatedUser) {
          user.inputTokensRemaining = updatedUser.inputTokensRemaining;
          user.outputTokensRemaining = updatedUser.outputTokensRemaining;
          user.tokenResetDate = updatedUser.tokenResetDate;
        }
      }

      const hasEnoughInputTokens =
        user.inputTokensRemaining >= requiredInputTokens;
      const hasEnoughOutputTokens =
        user.outputTokensRemaining >= requiredOutputTokens;
      const hasEnoughTokens = hasEnoughInputTokens && hasEnoughOutputTokens;
      const isTokensExhausted =
        user.inputTokensRemaining <= 0 || user.outputTokensRemaining <= 0;

      return {
        success: true,
        data: {
          inputTokensRemaining: user.inputTokensRemaining,
          outputTokensRemaining: user.outputTokensRemaining,
          tokenResetDate: user.tokenResetDate,
          hasEnoughTokens,
          isTokensExhausted,
        },
      };
    } catch (error) {
      logger.error("Failed to check token availability", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        requiredInputTokens,
        requiredOutputTokens,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to check token availability", 500);
    }
  }

  /**
   * Consume tokens after successful API call
   */
  async consumeTokens(
    userId: string,
    usage: TokenUsage
  ): Promise<ServiceResponse<TokenStatus>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Free users don't use token system
      if (user.plan === UserPlan.FREE) {
        return {
          success: true,
          data: {
            inputTokensRemaining: 0,
            outputTokensRemaining: 0,
            tokenResetDate: null,
            hasEnoughTokens: true,
            isTokensExhausted: false,
          },
        };
      }

      // Check if user has enough tokens
      if (
        user.inputTokensRemaining < usage.inputTokens ||
        user.outputTokensRemaining < usage.outputTokens
      ) {
        throw new AppError("Insufficient tokens", 402);
      }

      // Consume tokens
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          inputTokensRemaining: { decrement: usage.inputTokens },
          outputTokensRemaining: { decrement: usage.outputTokens },
        },
        select: {
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
        },
      });

      logger.info("Tokens consumed", {
        userId,
        inputTokensUsed: usage.inputTokens,
        outputTokensUsed: usage.outputTokens,
        inputTokensRemaining: updatedUser.inputTokensRemaining,
        outputTokensRemaining: updatedUser.outputTokensRemaining,
      });

      const isTokensExhausted =
        updatedUser.inputTokensRemaining <= 0 ||
        updatedUser.outputTokensRemaining <= 0;

      return {
        success: true,
        data: {
          inputTokensRemaining: updatedUser.inputTokensRemaining,
          outputTokensRemaining: updatedUser.outputTokensRemaining,
          tokenResetDate: updatedUser.tokenResetDate,
          hasEnoughTokens: !isTokensExhausted,
          isTokensExhausted,
        },
      };
    } catch (error) {
      logger.error("Failed to consume tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        usage,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to consume tokens", 500);
    }
  }

  /**
   * Reset tokens at the end of billing cycle
   */
  async resetTokens(userId: string): Promise<ServiceResponse<void>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, nextBillingDate: true },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.plan !== UserPlan.PREMIUM) {
        return { success: true }; // Nothing to reset for free users
      }

      // Calculate next reset date (next billing cycle)
      const nextResetDate = user.nextBillingDate || this.getNextMonthDate();

      await prisma.user.update({
        where: { id: userId },
        data: {
          inputTokensRemaining: config.tokens.premiumInputTokens,
          outputTokensRemaining: config.tokens.premiumOutputTokens,
          tokenResetDate: nextResetDate,
        },
      });

      logger.info("Tokens reset for new billing cycle", {
        userId,
        inputTokens: config.tokens.premiumInputTokens,
        outputTokens: config.tokens.premiumOutputTokens,
        nextResetDate,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to reset tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to reset tokens", 500);
    }
  }

  /**
   * Get token status for a user
   */
  async getTokenStatus(userId: string): Promise<ServiceResponse<TokenStatus>> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          inputTokensRemaining: true,
          outputTokensRemaining: true,
          tokenResetDate: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Free users don't use token system
      if (user.plan === UserPlan.FREE) {
        return {
          success: true,
          data: {
            inputTokensRemaining: 0,
            outputTokensRemaining: 0,
            tokenResetDate: null,
            hasEnoughTokens: true,
            isTokensExhausted: false,
          },
        };
      }

      // Check if tokens need to be reset
      const now = new Date();
      if (user.tokenResetDate && user.tokenResetDate <= now) {
        await this.resetTokens(userId);
        return this.getTokenStatus(userId); // Recursive call to get updated status
      }

      const isTokensExhausted =
        user.inputTokensRemaining <= 0 || user.outputTokensRemaining <= 0;

      return {
        success: true,
        data: {
          inputTokensRemaining: user.inputTokensRemaining,
          outputTokensRemaining: user.outputTokensRemaining,
          tokenResetDate: user.tokenResetDate,
          hasEnoughTokens: !isTokensExhausted,
          isTokensExhausted,
        },
      };
    } catch (error) {
      logger.error("Failed to get token status", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get token status", 500);
    }
  }

  /**
   * Reset all premium users' tokens (cron job for billing cycle)
   */
  async resetAllPremiumTokens(): Promise<
    ServiceResponse<{ usersUpdated: number }>
  > {
    try {
      const now = new Date();

      // Find premium users whose token reset date has passed
      const usersToReset = await prisma.user.findMany({
        where: {
          plan: UserPlan.PREMIUM,
          tokenResetDate: {
            lte: now,
          },
        },
        select: { id: true, nextBillingDate: true },
      });

      let updatedCount = 0;

      for (const user of usersToReset) {
        try {
          const nextResetDate = user.nextBillingDate || this.getNextMonthDate();

          await prisma.user.update({
            where: { id: user.id },
            data: {
              inputTokensRemaining: config.tokens.premiumInputTokens,
              outputTokensRemaining: config.tokens.premiumOutputTokens,
              tokenResetDate: nextResetDate,
            },
          });

          updatedCount++;
        } catch (userError) {
          logger.error("Failed to reset tokens for user", {
            userId: user.id,
            error: userError,
          });
        }
      }

      logger.info("Bulk token reset completed", {
        totalUsers: usersToReset.length,
        successfulUpdates: updatedCount,
      });

      return {
        success: true,
        data: { usersUpdated: updatedCount },
      };
    } catch (error) {
      logger.error("Failed to reset all premium tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw new AppError("Failed to reset premium tokens", 500);
    }
  }

  /**
   * Helper method to get next month date
   */
  private getNextMonthDate(): Date {
    const now = new Date();
    const nextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate()
    );
    return nextMonth;
  }

  /**
   * Estimate token usage for a transcript (rough estimation)
   */
  estimateTokenUsage(transcriptText: string): TokenUsage {
    // Rough estimation: 1 token ≈ 4 characters for input
    // Output is typically 10-20% of input for summaries
    const inputTokens = Math.ceil(transcriptText.length / 4);
    const outputTokens = Math.ceil(inputTokens * 0.15); // 15% of input as rough estimate

    return {
      inputTokens,
      outputTokens,
    };
  }
}

export const tokenService = new TokenService();
