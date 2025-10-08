import { firebaseAuth } from "../config/firebase";
import { prisma } from "../config/database";
import { config } from "../config";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  AuthUser,
  LoginResponse,
  ServiceResponse,
  RegisterDto,
  LoginDto,
  CreateUserData,
} from "../types";

export class AuthService {
  // Convert user to AuthUser format
  private formatUser(user: any): AuthUser {
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
    };
  }

  // Register new user with Firebase
  async register(data: RegisterDto): Promise<ServiceResponse<LoginResponse>> {
    try {
      // Check if user already exists in our database
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (existingUser) {
        throw new AppError("User already exists with this email", 409);
      }

      // Create user in Firebase Auth
      const firebaseUser = await firebaseAuth.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        displayName: data.name || null,
        emailVerified: false,
      });

      // Create user in our database
      const userData: CreateUserData = {
        email: data.email.toLowerCase(),
        name: data.name || null,
        avatar: null,
        plan: "FREE",
        credits: config.credits.freeMonthly,
        subscriptionId: null,
        subscriptionStatus: "free",
        nextBillingDate: null,
        cancelAtBillingDate: false,
        firebaseUid: firebaseUser.uid,
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
          subscriptionId: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          firebaseUid: true,
        },
      });

      // Generate custom token for the user to use on client side
      const customToken = await firebaseAuth.createCustomToken(
        firebaseUser.uid,
        {
          userId: user.id,
          email: user.email,
          plan: user.plan,
        }
      );

      const response: LoginResponse = {
        user: this.formatUser(user),
        accessToken: customToken, // This is for client-side signInWithCustomToken
        refreshToken: "", // Firebase handles refresh tokens automatically
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
      };

      logger.info("User registered successfully", {
        userId: user.id,
        email: user.email,
        firebaseUid: firebaseUser.uid,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error("Registration failed", { error, email: data.email });

      // If Firebase user was created but database insertion failed, clean up
      if (
        error instanceof Error &&
        !error.message.includes("User already exists")
      ) {
        try {
          // Try to find and delete the Firebase user if it was created
          const firebaseUsers = await firebaseAuth.getUserByEmail(
            data.email.toLowerCase()
          );
          if (firebaseUsers) {
            await firebaseAuth.deleteUser(firebaseUsers.uid);
            logger.info("Cleaned up Firebase user after registration failure", {
              email: data.email,
            });
          }
        } catch (cleanupError) {
          logger.error(
            "Failed to cleanup Firebase user after registration failure",
            { cleanupError }
          );
        }
      }

      throw error instanceof AppError
        ? error
        : new AppError("Registration failed", 500);
    }
  }

  // Login user - This method is mainly for creating custom tokens
  // In a real app, login would happen on client-side with Firebase SDK
  async login(data: LoginDto): Promise<ServiceResponse<LoginResponse>> {
    try {
      // Find user by email in our database
      const user = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
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
          firebaseUid: true,
        },
      });

      if (!user || !user.firebaseUid) {
        throw new AppError("Invalid email or password", 401);
      }

      // Verify user exists in Firebase
      try {
        const firebaseUser = await firebaseAuth.getUser(user.firebaseUid);
        if (!firebaseUser) {
          throw new AppError("Invalid email or password", 401);
        }
      } catch (firebaseError) {
        logger.error("Firebase user verification failed", { firebaseError });
        throw new AppError("Invalid email or password", 401);
      }

      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate custom token for the user
      const customToken = await firebaseAuth.createCustomToken(
        user.firebaseUid,
        {
          userId: user.id,
          email: user.email,
          plan: user.plan,
        }
      );

      const response: LoginResponse = {
        user: this.formatUser(user),
        accessToken: customToken,
        refreshToken: "", // Firebase handles refresh tokens automatically
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
      };

      logger.info("User logged in successfully", {
        userId: user.id,
        email: user.email,
        firebaseUid: user.firebaseUid,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error("Login failed", { error, email: data.email });
      throw error instanceof AppError
        ? error
        : new AppError("Login failed", 500);
    }
  }

  // Verify Firebase ID token
  async verifyToken(idToken: string): Promise<ServiceResponse<AuthUser>> {
    try {
      // Verify the Firebase ID token
      const decodedToken = await firebaseAuth.verifyIdToken(idToken);

      // Find user in our database
      const user = await prisma.user.findUnique({
        where: { firebaseUid: decodedToken.uid },
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
          firebaseUid: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      return { success: true, data: this.formatUser(user) };
    } catch (error) {
      logger.error("Token verification failed", { error });
      throw error instanceof AppError
        ? error
        : new AppError("Invalid token", 401);
    }
  }

  // Refresh token is handled by Firebase SDK on client side
  async refreshToken(
    refreshToken: string
  ): Promise<ServiceResponse<LoginResponse>> {
    // Firebase handles token refresh on the client side
    // This method is kept for compatibility but should not be used
    throw new AppError(
      "Token refresh should be handled by Firebase SDK on client side",
      400
    );
  }

  // Logout user (revoke refresh tokens)
  async logout(uid: string): Promise<ServiceResponse<void>> {
    try {
      // Revoke all refresh tokens for the user
      await firebaseAuth.revokeRefreshTokens(uid);

      logger.info("User logged out successfully", { firebaseUid: uid });
      return { success: true };
    } catch (error) {
      logger.error("Logout failed", { error, uid });
      throw new AppError("Logout failed", 500);
    }
  }

  // Get current user by Firebase UID
  async getCurrentUser(uid: string): Promise<ServiceResponse<AuthUser>> {
    try {
      const user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
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
          firebaseUid: true,
        },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      return { success: true, data: this.formatUser(user) };
    } catch (error) {
      logger.error("Get current user failed", { error, uid });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get user", 500);
    }
  }

  // Forgot password using Firebase
  async forgotPassword(email: string): Promise<ServiceResponse<void>> {
    try {
      // Check if user exists in our database
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user || !user.firebaseUid) {
        // Don't reveal that user doesn't exist
        return { success: true };
      }

      // Firebase password reset is handled on the client side
      // We just log that a password reset was requested
      logger.info("Password reset requested", {
        userId: user.id,
        email,
        firebaseUid: user.firebaseUid,
      });

      return { success: true };
    } catch (error) {
      logger.error("Forgot password failed", { error, email });
      throw new AppError("Password reset failed", 500);
    }
  }

  // Reset password is handled by Firebase on client side
  async resetPassword(
    token: string,
    newPassword: string
  ): Promise<ServiceResponse<void>> {
    // Firebase handles password reset on the client side
    throw new AppError(
      "Password reset should be handled by Firebase SDK on client side",
      400
    );
  }

  // Verify email using Firebase
  async verifyEmail(uid: string): Promise<ServiceResponse<void>> {
    try {
      // Update email verification status in Firebase
      await firebaseAuth.updateUser(uid, {
        emailVerified: true,
      });

      // Update in our database
      await prisma.user.updateMany({
        where: { firebaseUid: uid },
        data: { emailVerified: true },
      });

      logger.info("Email verification completed", { firebaseUid: uid });
      return { success: true };
    } catch (error) {
      logger.error("Email verification failed", { error, uid });
      throw new AppError("Email verification failed", 500);
    }
  }

  // Revoke all refresh tokens for a user
  async revokeAllTokens(uid: string): Promise<ServiceResponse<void>> {
    try {
      await firebaseAuth.revokeRefreshTokens(uid);

      logger.info("All tokens revoked", { firebaseUid: uid });
      return { success: true };
    } catch (error) {
      logger.error("Token revocation failed", { error, uid });
      throw new AppError("Token revocation failed", 500);
    }
  }

  // Delete user account
  async deleteUser(uid: string): Promise<ServiceResponse<void>> {
    try {
      // Delete from Firebase
      await firebaseAuth.deleteUser(uid);

      // Delete from our database
      await prisma.user.deleteMany({
        where: { firebaseUid: uid },
      });

      logger.info("User account deleted", { firebaseUid: uid });
      return { success: true };
    } catch (error) {
      logger.error("User deletion failed", { error, uid });
      throw new AppError("User deletion failed", 500);
    }
  }

  // Sync user from Firebase token to database
  async syncUserFromToken(idToken: string): Promise<ServiceResponse<AuthUser>> {
    try {
      const decodedToken = await firebaseAuth.verifyIdToken(idToken);
      const firebaseUser = await firebaseAuth.getUser(decodedToken.uid);

      // Check if user exists in our database
      let user = await prisma.user.findUnique({
        where: { firebaseUid: decodedToken.uid },
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
          firebaseUid: true,
        },
      });

      if (!user) {
        // Create user in our database if they don't exist
        const userData: CreateUserData = {
          email: firebaseUser.email!.toLowerCase(),
          name: firebaseUser.displayName || null,
          avatar: firebaseUser.photoURL || null,
          plan: "FREE",
          credits: config.credits.freeMonthly,
          subscriptionId: null,
          subscriptionStatus: "free",
          nextBillingDate: null,
          cancelAtBillingDate: false,
          firebaseUid: firebaseUser.uid,
          emailVerified: firebaseUser.emailVerified || false,
          lastLoginAt: new Date(),
        };

        user = await prisma.user.create({
          data: userData,
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
            firebaseUid: true,
          },
        });

        logger.info("User synced from Firebase token", {
          userId: user.id,
          email: user.email,
          firebaseUid: user.firebaseUid,
        });
      } else {
        // Update last login time
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
      }

      return { success: true, data: this.formatUser(user) };
    } catch (error) {
      logger.error("User sync from token failed", { error });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to sync user", 500);
    }
  }

  // Cleanup expired tokens (Firebase handles this automatically)
  async cleanupExpiredTokens(): Promise<void> {
    try {
      // Firebase automatically handles token cleanup
      // This method exists for compatibility with cleanup tasks
      logger.info("Token cleanup completed (handled by Firebase)");
    } catch (error) {
      logger.error("Token cleanup failed", { error });
    }
  }
}

export const authService = new AuthService();
