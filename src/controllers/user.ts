import { Response } from 'express';
import { userService } from '../services/user';
import {
  AuthenticatedRequest,
  ApiResponse,
  UpdateProfileDto,
} from '../types';
import { catchAsync } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export class UserController {
  // Get user profile
  getProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const result = await userService.getUserProfile(req.user.id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Update user profile
  updateProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const updates: UpdateProfileDto = req.body;

    const result = await userService.updateUserProfile(req.user.id, updates);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: 'Profile updated successfully',
    };

    logger.info('User profile updated', {
      userId: req.user.id,
      updates: Object.keys(updates),
    });

    res.json(response);
  });

  // Get user statistics
  getStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const result = await userService.getUserStats(req.user.id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Add credits to user account
  addCredits = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const { credits } = req.body;

    if (!credits || credits <= 0) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid credits amount',
      };
      return res.status(400).json(response);
    }

    const result = await userService.addCredits(req.user.id, credits);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: `${credits} credits added successfully`,
    };

    logger.info('Credits added to user', {
      userId: req.user.id,
      creditsAdded: credits,
      newBalance: result.data?.newBalance,
    });

    res.json(response);
  });

  // Upgrade user plan
  upgradePlan = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const { plan } = req.body;

    if (!plan || !['FREE', 'PREMIUM'].includes(plan)) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid plan type',
      };
      return res.status(400).json(response);
    }

    const result = await userService.upgradePlan(req.user.id, plan);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: `Plan upgraded to ${plan} successfully`,
    };

    logger.info('User plan upgraded', {
      userId: req.user.id,
      newPlan: plan,
    });

    res.json(response);
  });

  // Delete user account
  deleteAccount = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    await userService.deleteUser(req.user.id);

    const response: ApiResponse = {
      success: true,
      message: 'Account deleted successfully',
    };

    logger.info('User account deleted', {
      userId: req.user.id,
      email: req.user.email,
    });

    res.json(response);
  });

  // Verify user email
  verifyEmail = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    await userService.verifyEmail(req.user.id);

    const response: ApiResponse = {
      success: true,
      message: 'Email verified successfully',
    };

    logger.info('User email verified', {
      userId: req.user.id,
    });

    res.json(response);
  });
}

export const userController = new UserController();