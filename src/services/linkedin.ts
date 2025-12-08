// src/services/linkedin.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  LinkedinPostData,
  SaveLinkedinPostDto,
  UpdateLinkedinPostDto,
  ServiceResponse,
  PaginatedResponse,
  LinkedinPostQueryParams,
  LinkedinPostStats,
} from "../types";

export class LinkedinService {
  // Save LinkedIn post
  async savePost(
    userId: string,
    data: SaveLinkedinPostDto
  ): Promise<ServiceResponse<LinkedinPostData>> {
    try {
      // Check if post already exists (prevent duplicates)
      const existingPost = await prisma.linkedinPost.findFirst({
        where: {
          userId,
          postUrl: data.postUrl,
        },
      });

      if (existingPost) {
        // Return existing post instead of creating duplicate
        return {
          success: true,
          data: this.formatPost(existingPost),
        };
      }

      // Create new LinkedIn post
      const linkedinPost = await prisma.linkedinPost.create({
        data: {
          title: data.title || null,
          content: data.content,
          author: data.author,
          postUrl: data.postUrl,
          linkedinPostId: data.linkedinPostId || null,
          platform: data.platform || "linkedin",
          engagement: data.engagement
            ? JSON.stringify(data.engagement)
            : undefined,
          metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
          userId,
        },
      });

      logger.info("LinkedIn post saved successfully", {
        userId,
        postId: linkedinPost.id,
        author: data.author,
        postUrl: data.postUrl,
      });

      return {
        success: true,
        data: this.formatPost(linkedinPost),
      };
    } catch (error) {
      logger.error("LinkedIn post save failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postData: {
          author: data.author,
          postUrl: data.postUrl,
        },
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to save LinkedIn post", 500);
    }
  }

  // Get user's LinkedIn posts with pagination and filtering
  async getPosts(
    userId: string,
    params: LinkedinPostQueryParams = {}
  ): Promise<ServiceResponse<PaginatedResponse<LinkedinPostData>>> {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        author,
        startDate,
        endDate,
        sortBy = "savedAt",
        sortOrder = "desc",
      } = params;

      // Build where clause
      const where: Prisma.LinkedinPostWhereInput = {
        userId,
        ...(author && {
          author: {
            contains: author,
            mode: "insensitive",
          },
        }),
        ...(startDate &&
          endDate && {
            savedAt: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { content: { contains: search, mode: "insensitive" } },
            { author: { contains: search, mode: "insensitive" } },
          ],
        }),
      };

      // Get total count
      const total = await prisma.linkedinPost.count({ where });

      // Get posts
      const posts = await prisma.linkedinPost.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      });

      const totalPages = Math.ceil(total / limit);

      const response: PaginatedResponse<LinkedinPostData> = {
        data: posts.map((post) => this.formatPost(post)),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };

      return { success: true, data: response };
    } catch (error) {
      logger.error("Get LinkedIn posts failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        params,
      });
      throw new AppError("Failed to get LinkedIn posts", 500);
    }
  }

  // Get single LinkedIn post by ID
  async getPostById(
    userId: string,
    postId: string
  ): Promise<ServiceResponse<LinkedinPostData>> {
    try {
      const post = await prisma.linkedinPost.findFirst({
        where: {
          id: postId,
          userId,
        },
      });

      if (!post) {
        throw new AppError("LinkedIn post not found", 404);
      }

      return {
        success: true,
        data: this.formatPost(post),
      };
    } catch (error) {
      logger.error("Get LinkedIn post by ID failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get LinkedIn post", 500);
    }
  }

  // Update LinkedIn post
  async updatePost(
    userId: string,
    postId: string,
    updates: UpdateLinkedinPostDto
  ): Promise<ServiceResponse<LinkedinPostData>> {
    try {
      const existingPost = await prisma.linkedinPost.findFirst({
        where: {
          id: postId,
          userId,
        },
      });

      if (!existingPost) {
        throw new AppError("LinkedIn post not found", 404);
      }

      const updatedPost = await prisma.linkedinPost.update({
        where: { id: postId },
        data: {
          ...(updates.title !== undefined && { title: updates.title }),
          ...(updates.content && { content: updates.content }),
          ...(updates.author && { author: updates.author }),
          ...(updates.engagement && {
            engagement: JSON.stringify(updates.engagement),
          }),
          ...(updates.metadata && {
            metadata: JSON.stringify(updates.metadata),
          }),
        },
      });

      logger.info("LinkedIn post updated successfully", {
        userId,
        postId,
        updates: Object.keys(updates),
      });

      return {
        success: true,
        data: this.formatPost(updatedPost),
      };
    } catch (error) {
      logger.error("LinkedIn post update failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to update LinkedIn post", 500);
    }
  }

  // Delete LinkedIn post
  async deletePost(
    userId: string,
    postId: string
  ): Promise<ServiceResponse<void>> {
    try {
      const post = await prisma.linkedinPost.findFirst({
        where: {
          id: postId,
          userId,
        },
      });

      if (!post) {
        throw new AppError("LinkedIn post not found", 404);
      }

      await prisma.linkedinPost.delete({
        where: { id: postId },
      });

      logger.info("LinkedIn post deleted successfully", {
        userId,
        postId,
        author: post.author,
      });

      return { success: true };
    } catch (error) {
      logger.error("LinkedIn post deletion failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to delete LinkedIn post", 500);
    }
  }

  // Bulk delete LinkedIn posts
  async bulkDeletePosts(
    userId: string,
    postIds: string[]
  ): Promise<ServiceResponse<{ deletedCount: number }>> {
    try {
      if (postIds.length === 0) {
        return { success: true, data: { deletedCount: 0 } };
      }

      const result = await prisma.linkedinPost.deleteMany({
        where: {
          id: { in: postIds },
          userId,
        },
      });

      logger.info("LinkedIn posts bulk deleted", {
        userId,
        deletedCount: result.count,
        requestedCount: postIds.length,
      });

      return {
        success: true,
        data: { deletedCount: result.count },
      };
    } catch (error) {
      logger.error("LinkedIn posts bulk deletion failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postCount: postIds.length,
      });
      throw new AppError("Failed to delete LinkedIn posts", 500);
    }
  }

  // Get LinkedIn post statistics
  async getPostStats(
    userId: string
  ): Promise<ServiceResponse<LinkedinPostStats>> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalPosts,
        postsThisMonth,
        postsThisWeek,
        topAuthors,
        recentPosts,
      ] = await Promise.all([
        // Total posts
        prisma.linkedinPost.count({
          where: { userId },
        }),

        // Posts this month
        prisma.linkedinPost.count({
          where: {
            userId,
            savedAt: { gte: startOfMonth },
          },
        }),

        // Posts this week
        prisma.linkedinPost.count({
          where: {
            userId,
            savedAt: { gte: startOfWeek },
          },
        }),

        // Top authors (limit to 10)
        prisma.linkedinPost.groupBy({
          by: ["author"],
          where: { userId },
          _count: { author: true },
          orderBy: { _count: { author: "desc" } },
          take: 10,
        }),

        // Recent posts (limit to 5)
        prisma.linkedinPost.findMany({
          where: { userId },
          orderBy: { savedAt: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            author: true,
            savedAt: true,
          },
        }),
      ]);

      const stats: LinkedinPostStats = {
        totalPosts,
        postsThisMonth,
        postsThisWeek,
        topAuthors: topAuthors.map((item) => ({
          author: item.author,
          count: item._count.author,
        })),
        recentActivity: recentPosts.map((post) => ({
          id: post.id,
          title: post.title || `Post by ${post.author}`,
          author: post.author,
          savedAt: post.savedAt.toISOString(),
        })),
      };

      return { success: true, data: stats };
    } catch (error) {
      logger.error("Get LinkedIn post stats failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get LinkedIn post statistics", 500);
    }
  }

  // Format LinkedIn post for API response
  private formatPost(post: any): LinkedinPostData {
    return {
      id: post.id,
      title: post.title,
      content: post.content,
      author: post.author,
      postUrl: post.postUrl,
      linkedinPostId: post.linkedinPostId,
      platform: post.platform,
      engagement: post.engagement ? JSON.parse(post.engagement) : null,
      metadata: post.metadata ? JSON.parse(post.metadata) : null,
      savedAt: post.savedAt.toISOString(),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }
}

export const linkedinService = new LinkedinService();
