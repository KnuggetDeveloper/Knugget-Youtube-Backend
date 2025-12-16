import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  ServiceResponse,
  PaginatedResponse,
  LinkedinPostData,
  SaveLinkedinPostDto,
  UpdateLinkedinPostDto,
  LinkedinPostQueryParams,
  LinkedinPostStats,
} from "../types";

export class LinkedinService {
  // Save a LinkedIn post
  async savePost(
    userId: string,
    data: SaveLinkedinPostDto
  ): Promise<ServiceResponse<LinkedinPostData>> {
    try {
      // Check if post already exists for this user
      const existingPost = await prisma.linkedinPost.findUnique({
        where: {
          userId_postUrl: {
            userId,
            postUrl: data.postUrl,
          },
        },
      });

      if (existingPost) {
        // Return existing post instead of creating duplicate
        logger.info("LinkedIn post already saved", {
          userId,
          postUrl: data.postUrl,
        });
        return {
          success: true,
          data: this.formatPost(existingPost),
        };
      }

      // Create new post
      const post = await prisma.linkedinPost.create({
        data: {
          userId,
          linkedinPostId: data.linkedinPostId,
          title: data.title,
          content: data.content,
          author: data.author,
          authorUrl: data.authorUrl,
          authorImage: data.authorImage,
          postUrl: data.postUrl,
          imageUrl: data.imageUrl,
          platform: data.platform || "linkedin",
          engagement: data.engagement as any,
          metadata: data.metadata as any,
        },
      });

      logger.info("LinkedIn post saved successfully", {
        userId,
        postId: post.id,
        author: post.author,
      });

      return {
        success: true,
        data: this.formatPost(post),
      };
    } catch (error) {
      logger.error("Failed to save LinkedIn post", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postUrl: data.postUrl,
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
          author: { contains: author, mode: "insensitive" },
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
      logger.error("Failed to get LinkedIn posts", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        params,
      });
      throw new AppError("Failed to get LinkedIn posts", 500);
    }
  }

  // Get single post by ID
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
      logger.error("Failed to get LinkedIn post", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to get LinkedIn post", 500);
    }
  }

  // Update a LinkedIn post
  async updatePost(
    userId: string,
    postId: string,
    data: UpdateLinkedinPostDto
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
          title: data.title ?? existingPost.title,
          content: data.content ?? existingPost.content,
          author: data.author ?? existingPost.author,
          engagement: data.engagement
            ? (data.engagement as any)
            : existingPost.engagement,
          metadata: data.metadata
            ? (data.metadata as any)
            : existingPost.metadata,
        },
      });

      logger.info("LinkedIn post updated", {
        userId,
        postId,
        updates: Object.keys(data),
      });

      return {
        success: true,
        data: this.formatPost(updatedPost),
      };
    } catch (error) {
      logger.error("Failed to update LinkedIn post", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postId,
      });
      throw error instanceof AppError
        ? error
        : new AppError("Failed to update LinkedIn post", 500);
    }
  }

  // Delete a LinkedIn post
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

      logger.info("LinkedIn post deleted", {
        userId,
        postId,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to delete LinkedIn post", {
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
      logger.error("Failed to bulk delete LinkedIn posts", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postIds,
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
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());

      const [
        totalPosts,
        postsThisMonth,
        postsThisWeek,
        topAuthors,
        recentPosts,
      ] = await Promise.all([
        prisma.linkedinPost.count({
          where: { userId },
        }),
        prisma.linkedinPost.count({
          where: {
            userId,
            savedAt: { gte: startOfMonth },
          },
        }),
        prisma.linkedinPost.count({
          where: {
            userId,
            savedAt: { gte: startOfWeek },
          },
        }),
        prisma.linkedinPost.groupBy({
          by: ["author"],
          where: { userId },
          _count: { author: true },
          orderBy: { _count: { author: "desc" } },
          take: 5,
        }),
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

      return {
        success: true,
        data: {
          totalPosts,
          postsThisMonth,
          postsThisWeek,
          topAuthors: topAuthors.map((a) => ({
            author: a.author,
            count: a._count.author,
          })),
          recentPosts: recentPosts.map((p) => ({
            id: p.id,
            title: p.title || "Untitled",
            author: p.author,
            savedAt: p.savedAt.toISOString(),
          })),
        },
      };
    } catch (error) {
      logger.error("Failed to get LinkedIn post stats", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      throw new AppError("Failed to get LinkedIn post statistics", 500);
    }
  }

  // Check if post exists by URL
  async checkPostExists(
    userId: string,
    postUrl: string
  ): Promise<ServiceResponse<{ exists: boolean; post?: LinkedinPostData }>> {
    try {
      const post = await prisma.linkedinPost.findUnique({
        where: {
          userId_postUrl: {
            userId,
            postUrl,
          },
        },
      });

      return {
        success: true,
        data: {
          exists: !!post,
          post: post ? this.formatPost(post) : undefined,
        },
      };
    } catch (error) {
      logger.error("Failed to check LinkedIn post existence", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
        postUrl,
      });
      throw new AppError("Failed to check LinkedIn post", 500);
    }
  }

  // Format post for API response
  private formatPost(post: any): LinkedinPostData {
    return {
      id: post.id,
      linkedinPostId: post.linkedinPostId,
      title: post.title,
      content: post.content,
      author: post.author,
      authorUrl: post.authorUrl,
      authorImage: post.authorImage,
      postUrl: post.postUrl,
      imageUrl: post.imageUrl,
      platform: post.platform,
      engagement: this.parseJson(post.engagement),
      metadata: this.parseJson(post.metadata),
      savedAt: post.savedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  // Helper to parse JSON fields
  private parseJson(value: any): any {
    if (!value) return undefined;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
}

export const linkedinService = new LinkedinService();

