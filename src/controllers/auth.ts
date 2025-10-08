import { Response } from "express";
import { authService } from "../services/auth";
import {
  AuthenticatedRequest,
  ApiResponse,
  RegisterDto,
  LoginDto,
} from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

export class AuthController {
  // Register new user
  register = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { email, password, name }: RegisterDto = req.body;

    const result = await authService.register({ email, password, name });

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: "User registered successfully",
    };

    logger.info("User registration successful", {
      email,
      userAgent: req.get("User-Agent"),
    });
    res.status(201).json(response);
  });

  // Login user - Note: In production, login should happen on client-side with Firebase SDK
  login = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { email, password }: LoginDto = req.body;

    const result = await authService.login({ email, password });

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message:
        "Login successful. Use the custom token on client-side with Firebase SDK.",
    };

    logger.info("User login successful", {
      email,
      userAgent: req.get("User-Agent"),
      origin: req.get("Origin"),
    });
    res.json(response);
  });

  // Refresh access token - Not needed with Firebase
  refresh = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const response: ApiResponse = {
      success: false,
      error:
        "Token refresh is handled automatically by Firebase SDK on client-side",
    };

    res.status(400).json(response);
  });

  // Logout user
  logout = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.firebaseUid) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    await authService.logout(req.user.firebaseUid);

    const response: ApiResponse = {
      success: true,
      message: "Logout successful",
    };

    logger.info("User logout successful", {
      userId: req.user?.id,
      firebaseUid: req.user.firebaseUid,
    });
    res.json(response);
  });

  // Get current user
  me = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    // User is already loaded by middleware, just return it
    const response: ApiResponse = {
      success: true,
      data: req.user,
    };

    res.json(response);
  });

  // Forgot password - Should be handled on client-side with Firebase SDK
  forgotPassword = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      const { email } = req.body;

      await authService.forgotPassword(email);

      const response: ApiResponse = {
        success: true,
        message:
          "If an account with this email exists, you can reset your password using Firebase SDK on the client-side.",
      };

      logger.info("Password reset requested", { email });
      res.json(response);
    }
  );

  // Reset password - Should be handled on client-side with Firebase SDK
  resetPassword = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      const response: ApiResponse = {
        success: false,
        error:
          "Password reset should be handled by Firebase SDK on client-side",
      };

      res.status(400).json(response);
    }
  );

  // Verify email
  verifyEmail = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.firebaseUid) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    await authService.verifyEmail(req.user.firebaseUid);

    const response: ApiResponse = {
      success: true,
      message: "Email verified successfully",
    };

    logger.info("Email verification completed", {
      firebaseUid: req.user.firebaseUid,
    });
    res.json(response);
  });

  // Revoke all tokens
  revokeAllTokens = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user?.firebaseUid) {
        return res
          .status(401)
          .json({ success: false, error: "User not authenticated" });
      }

      await authService.revokeAllTokens(req.user.firebaseUid);
      res.json({ success: true, message: "All tokens revoked successfully" });
    }
  );

  // Delete user account
  deleteAccount = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user?.firebaseUid) {
        return res
          .status(401)
          .json({ success: false, error: "User not authenticated" });
      }

      await authService.deleteUser(req.user.firebaseUid);

      const response: ApiResponse = {
        success: true,
        message: "Account deleted successfully",
      };

      logger.info("User account deleted", {
        userId: req.user.id,
        firebaseUid: req.user.firebaseUid,
      });
      res.json(response);
    }
  );

  // Sync user from Firebase token (useful for first-time users from client-side Firebase auth)
  syncUser = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      const response: ApiResponse = {
        success: false,
        error: "Authorization token required",
      };
      return res.status(401).json(response);
    }

    const result = await authService.syncUserFromToken(token);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: "User synced successfully",
    };

    res.json(response);
  });
}

export const authController = new AuthController();
