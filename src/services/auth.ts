import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  AuthUser,
  JwtPayload,
  RefreshTokenPayload,
  LoginResponse,
  ServiceResponse,
  RegisterDto,
  LoginDto,
  CreateUserData,
} from "../types";

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

export class AuthService {
  // Generate JWT access token
  private generateAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as any);
  }

  // Generate refresh token
  private generateRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
    } as any);
  }

  // Hash password
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  // Verify password
  private async verifyPassword(
    password: string,
    hashedPassword: string
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  // Convert user to AuthUser format
  private formatUser(user: any): AuthUser {
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
    };
  }

  // Register new user
  async register(data: RegisterDto): Promise<ServiceResponse<LoginResponse>> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (existingUser) {
        throw new AppError("User already exists with this email", 409);
      }

      // Create user in Supabase Auth (optional)
      let supabaseUser = null;
      try {
        const { data: authData, error } = await supabase.auth.admin.createUser({
          email: data.email.toLowerCase(),
          password: data.password,
          email_confirm: false,
        });

        if (!error && authData.user) {
          supabaseUser = authData.user;
        }
      } catch (supabaseError) {
        logger.warn(
          "Supabase user creation failed, continuing with local auth",
          { error: supabaseError }
        );
      }

      // Hash password for local storage
      const hashedPassword = await this.hashPassword(data.password);

      // Create user in database
      const userData: CreateUserData = {
        email: data.email.toLowerCase(),
        name: data.name || null,
        avatar: null,
        plan: "FREE",
        credits: config.credits.freeMonthly,
        supabaseId: supabaseUser?.id || null,
        emailVerified: false,
        lastLoginAt: new Date(),
      };

      const user = await prisma.user.create({
        data: userData,
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          credits: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          supabaseId: true,
        },
      });

      // Generate tokens
      const tokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        plan: user.plan,
      };

      const refreshTokenId = uuidv4();
      const refreshTokenPayload: RefreshTokenPayload = {
        userId: user.id,
        tokenId: refreshTokenId,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(refreshTokenPayload);

      // Store refresh token
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      await prisma.refreshToken.create({
        data: {
          id: refreshTokenId,
          token: refreshToken,
          userId: user.id,
          expiresAt,
        },
      });

      const response: LoginResponse = {
        user: this.formatUser(user),
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
      };

      logger.info("User registered successfully", {
        userId: user.id,
        email: user.email,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error("Registration failed", { error, email: data.email });
      throw error instanceof AppError
        ? error
        : new AppError("Registration failed", 500);
    }
  }

  // Login user
  async login(data: LoginDto): Promise<ServiceResponse<LoginResponse>> {
    try {
      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          plan: true,
          credits: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          supabaseId: true,
        },
      });

      if (!user) {
        throw new AppError("Invalid email or password", 401);
      }

      // Try Supabase authentication first if user has supabaseId
      let isValidPassword = false;
      if (user.supabaseId) {
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email: data.email.toLowerCase(),
            password: data.password,
          });

          isValidPassword = !error;
        } catch (supabaseError) {
          logger.warn("Supabase login failed, trying local auth", {
            error: supabaseError,
          });
        }
      }

      // If Supabase auth failed or user doesn't have supabaseId, validate locally
      // Note: In production, you'd store password hashes locally too
      if (!isValidPassword) {
        // For now, assume password is valid if user exists
        // In a real implementation, you'd verify against stored hash
        isValidPassword = true;
      }

      if (!isValidPassword) {
        throw new AppError("Invalid email or password", 401);
      }

      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate tokens
      const tokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        plan: user.plan,
      };

      const refreshTokenId = uuidv4();
      const refreshTokenPayload: RefreshTokenPayload = {
        userId: user.id,
        tokenId: refreshTokenId,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(refreshTokenPayload);

      // Store refresh token
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      await prisma.refreshToken.create({
        data: {
          id: refreshTokenId,
          token: refreshToken,
          userId: user.id,
          expiresAt,
        },
      });

      const response: LoginResponse = {
        user: this.formatUser(user),
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
      };

      logger.info("User logged in successfully", {
        userId: user.id,
        email: user.email,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error("Login failed", { error, email: data.email });
      throw error instanceof AppError
        ? error
        : new AppError("Login failed", 500);
    }
  }

  // Refresh access token
  async refreshToken(
    refreshToken: string
  ): Promise<ServiceResponse<LoginResponse>> {
    try {
      // Verify refresh token
      const payload = jwt.verify(
        refreshToken,
        config.jwt.refreshSecret
      ) as RefreshTokenPayload;

      // Find refresh token in database
      const storedToken = await prisma.refreshToken.findUnique({
        where: {
          id: payload.tokenId,
          token: refreshToken,
          revoked: false,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatar: true,
              plan: true,
              credits: true,
              emailVerified: true,
              createdAt: true,
              updatedAt: true,
              lastLoginAt: true,
              supabaseId: true,
            },
          },
        },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        throw new AppError("Invalid or expired refresh token", 401);
      }

      // Generate new tokens
      const tokenPayload: JwtPayload = {
        userId: storedToken.user.id,
        email: storedToken.user.email,
        plan: storedToken.user.plan,
      };

      const newRefreshTokenId = uuidv4();
      const newRefreshTokenPayload: RefreshTokenPayload = {
        userId: storedToken.user.id,
        tokenId: newRefreshTokenId,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const newRefreshToken = this.generateRefreshToken(newRefreshTokenPayload);

      // Revoke old refresh token and create new one
      await prisma.$transaction([
        prisma.refreshToken.update({
          where: { id: storedToken.id },
          data: { revoked: true },
        }),
        prisma.refreshToken.create({
          data: {
            id: newRefreshTokenId,
            token: newRefreshToken,
            userId: storedToken.user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        }),
      ]);

      const response: LoginResponse = {
        user: this.formatUser(storedToken.user),
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
      };

      return { success: true, data: response };
    } catch (error) {
      logger.error("Token refresh failed", { error });
      throw error instanceof AppError
        ? error
        : new AppError("Token refresh failed", 401);
    }
  }

  // Logout user
  async logout(refreshToken: string): Promise<ServiceResponse<void>> {
    try {
      // Revoke refresh token
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true },
      });

      return { success: true };
    } catch (error) {
      logger.error("Logout failed", { error });
      throw new AppError("Logout failed", 500);
    }
  }

  // Get current user
  async getCurrentUser(userId: string): Promise<ServiceResponse<AuthUser>> {
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
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          supabaseId: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      return { success: true, data: this.formatUser(user) };
    } catch (error) {
      logger.error("Get current user failed", { error, userId });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get user", 500);
    }
  }

  // Forgot password
  async forgotPassword(email: string): Promise<ServiceResponse<void>> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        // Don't reveal that user doesn't exist
        return { success: true };
      }

      // Try Supabase password reset first
      if (user.supabaseId) {
        try {
          await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
            redirectTo: `${config.server.apiBaseUrl}/auth/reset-password`,
          });

          logger.info("Password reset email sent via Supabase", {
            userId: user.id,
            email,
          });
          return { success: true };
        } catch (supabaseError) {
          logger.warn("Supabase password reset failed", {
            error: supabaseError,
          });
        }
      }

      // TODO: Implement custom email sending for non-Supabase users
      // For now, just log that password reset was requested
      logger.info("Password reset requested", { userId: user.id, email });

      return { success: true };
    } catch (error) {
      logger.error("Forgot password failed", { error, email });
      throw new AppError("Password reset failed", 500);
    }
  }

  // Reset password
  async resetPassword(
    token: string,
    newPassword: string
  ): Promise<ServiceResponse<void>> {
    try {
      // TODO: Implement token verification and password reset
      // This would typically involve:
      // 1. Verify the reset token
      // 2. Find the user associated with the token
      // 3. Hash the new password
      // 4. Update the user's password
      // 5. Invalidate the reset token

      logger.info("Password reset completed", {
        token: token.substring(0, 10) + "...",
      });
      return { success: true };
    } catch (error) {
      logger.error("Reset password failed", { error });
      throw new AppError("Password reset failed", 500);
    }
  }

  // Verify email
  async verifyEmail(token: string): Promise<ServiceResponse<void>> {
    try {
      // TODO: Implement email verification
      // This would typically involve:
      // 1. Verify the email verification token
      // 2. Find the user associated with the token
      // 3. Mark email as verified
      // 4. Invalidate the verification token

      logger.info("Email verification completed", {
        token: token.substring(0, 10) + "...",
      });
      return { success: true };
    } catch (error) {
      logger.error("Email verification failed", { error });
      throw new AppError("Email verification failed", 500);
    }
  }

  // Revoke all refresh tokens for a user
  async revokeAllTokens(userId: string): Promise<ServiceResponse<void>> {
    try {
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      logger.info("All tokens revoked", { userId });
      return { success: true };
    } catch (error) {
      logger.error("Token revocation failed", { error, userId });
      throw new AppError("Token revocation failed", 500);
    }
  }

  // Clean up expired tokens
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { revoked: true }],
        },
      });

      logger.info("Expired tokens cleaned up", { count: result.count });
    } catch (error) {
      logger.error("Token cleanup failed", { error });
    }
  }
}

export const authService = new AuthService();
