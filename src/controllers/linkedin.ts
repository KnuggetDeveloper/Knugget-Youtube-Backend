// src/controllers/linkedin.ts
import { Response } from "express";
import { linkedinService } from "../services/linkedin";
import {
  AuthenticatedRequest,
  ApiResponse,
  SaveLinkedinPostDto,
  UpdateLinkedinPostDto,
  LinkedinPostQueryParams,
} from "../types";
import { catchAsync } from "../middleware/errorHandler";
import { logger } from "../config/logger";

export class LinkedinController {
  // Save LinkedIn post
  savePost = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const postData: SaveLinkedinPostDto = req.body;

    const result = await linkedinService.savePost(req.user.id, postData);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: "LinkedIn post saved successfully",
    };

    logger.info("LinkedIn post saved", {
      userId: req.user.id,
      postId: result.data?.id,
      author: postData.author,
      postUrl: postData.postUrl,
    });

    res.json(response);
  });

  // Get user's LinkedIn posts with pagination and filtering
  getPosts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    // Parse query parameters
    const queryParams: LinkedinPostQueryParams = {
      page: req.query.page
        ? Math.max(1, parseInt(req.query.page as string) || 1)
        : 1,
      limit: req.query.limit
        ? Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
        : 20,
      search: req.query.search ? String(req.query.search) : undefined,
      author: req.query.author ? String(req.query.author) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      sortBy: (req.query.sortBy as any) || "savedAt",
      sortOrder: (req.query.sortOrder as any) || "desc",
    };

    const result = await linkedinService.getPosts(req.user.id, queryParams);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Get single LinkedIn post by ID
  getPostById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const { id } = req.params;

    const result = await linkedinService.getPostById(req.user.id, id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Update LinkedIn post
  updatePost = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const { id } = req.params;
    const updates: UpdateLinkedinPostDto = req.body;

    const result = await linkedinService.updatePost(req.user.id, id, updates);

    const response: ApiResponse = {
      success: true,
      data: result.data,
      message: "LinkedIn post updated successfully",
    };

    logger.info("LinkedIn post updated", {
      userId: req.user.id,
      postId: id,
      updates: Object.keys(updates),
    });

    res.json(response);
  });

  // Delete LinkedIn post
  deletePost = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const { id } = req.params;

    await linkedinService.deletePost(req.user.id, id);

    const response: ApiResponse = {
      success: true,
      message: "LinkedIn post deleted successfully",
    };

    logger.info("LinkedIn post deleted", {
      userId: req.user.id,
      postId: id,
    });

    res.json(response);
  });

  // Get LinkedIn post statistics
  getStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: "User not authenticated",
      };
      return res.status(401).json(response);
    }

    const result = await linkedinService.getPostStats(req.user.id);

    const response: ApiResponse = {
      success: true,
      data: result.data,
    };

    res.json(response);
  });

  // Bulk delete posts
  bulkDeletePosts = catchAsync(
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        const response: ApiResponse = {
          success: false,
          error: "User not authenticated",
        };
        return res.status(401).json(response);
      }

      const { postIds } = req.body;

      if (!Array.isArray(postIds) || postIds.length === 0) {
        const response: ApiResponse = {
          success: false,
          error: "Post IDs array is required",
        };
        return res.status(400).json(response);
      }

      const result = await linkedinService.bulkDeletePosts(req.user.id, postIds);

      const response: ApiResponse = {
        success: true,
        data: result.data,
        message: `${result.data?.deletedCount || 0} LinkedIn posts deleted successfully`,
      };

      logger.info("LinkedIn posts bulk deleted", {
        userId: req.user.id,
        deletedCount: result.data?.deletedCount || 0,
      });

      res.json(response);
    }
  );
}

export const linkedinController = new LinkedinController();

