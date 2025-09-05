import { Response } from 'express';
import { authService } from '../services/auth';
import { AuthenticatedRequest, ApiResponse, RegisterDto, LoginDto } from '../types';
import { catchAsync } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export class AuthController {
  // Register new user
  register = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { email, password, name }: RegisterDto = req.body;

    const result = await authService.register({ email, password, name });

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: 'User registered successfully',
    };

    logger.info('User registration successful', { email, userAgent: req.get('User-Agent') });
    res.status(201).json(response);
  });

  // Login user
  login = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { email, password }: LoginDto = req.body;

    const result = await authService.login({ email, password });

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: 'Login successful',
    };

    logger.info('User login successful', {
      email,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin')
    });
    res.json(response);
  });

  // Refresh access token
  refresh = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { refreshToken } = req.body;

    const result = await authService.refreshToken(refreshToken);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: 'Token refreshed successfully',
    };

    res.json(response);
  });

  // Logout user
  logout = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { refreshToken } = req.body;

    await authService.logout(refreshToken);

    const response: ApiResponse = {
      success: true,
      message: 'Logout successful',
    };

    logger.info('User logout successful', { userId: req.user?.id });
    res.json(response);
  });

  // Get current user
  me = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const result = await authService.getCurrentUser(req.user.id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Forgot password
  forgotPassword = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { email } = req.body;

    await authService.forgotPassword(email);

    const response: ApiResponse = {
      success: true,
      message: 'If an account with this email exists, a password reset link has been sent.',
    };

    logger.info('Password reset requested', { email });
    res.json(response);
  });

  // Reset password
  resetPassword = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { token, password } = req.body;

    await authService.resetPassword(token, password);

    const response: ApiResponse = {
      success: true,
      message: 'Password reset successful',
    };

    logger.info('Password reset completed');
    res.json(response);
  });

  // Verify email
  verifyEmail = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { token } = req.body;

    await authService.verifyEmail(token);

    const response: ApiResponse = {
      success: true,
      message: 'Email verified successfully',
    };

    logger.info('Email verification completed');
    res.json(response);
  });
  revokeAllTokens = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    await authService.revokeAllTokens(req.user.id);
    res.json({ success: true, message: 'All tokens revoked successfully' });
  });
}

export const authController = new AuthController();
