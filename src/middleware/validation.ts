import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { ApiResponse, ValidationError } from "../types";

// Auth validation schemas
export const registerSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").min(1, "Email is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password too long"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name too long")
      .optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").min(1, "Email is required"),
    password: z.string().min(1, "Password is required"),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").min(1, "Email is required"),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password too long"),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token is required"),
  }),
});

// User validation schemas
export const updateProfileSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, "Name cannot be empty")
      .max(100, "Name too long")
      .optional(),
    avatar: z.string().url("Invalid avatar URL").optional(),
  }),
});

// Summary validation schemas
const transcriptSegmentSchema = z.object({
  timestamp: z.string().min(1, "Timestamp is required"),
  text: z.string().min(1, "Text is required"),
  startSeconds: z.number().optional(),
  endSeconds: z.number().optional(),
});

const videoMetadataSchema = z.object({
  videoId: z.string().min(1, "Video ID is required"),
  title: z.string().min(1, "Video title is required"),
  channelName: z.string().min(1, "Channel name is required"),
  duration: z.string().optional(),
  url: z.string().url("Invalid video URL"),
  thumbnailUrl: z.string().url("Invalid thumbnail URL").optional(),
  description: z.string().optional(),
  publishedAt: z.string().optional(),
  viewCount: z.number().optional(),
  likeCount: z.number().optional(),
});

export const generateSummarySchema = z.object({
  body: z.object({
    transcript: z
      .array(transcriptSegmentSchema)
      .min(1, "Transcript segments are required"),
    videoMetadata: videoMetadataSchema,
  }),
});

export const saveSummarySchema = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required").max(200, "Title too long"),
    keyPoints: z.array(z.string()).min(1, "Key points are required"),
    fullSummary: z
      .string()
      .min(1, "Full summary is required")
      .max(5000, "Summary too long"),
    tags: z.array(z.string()).max(10, "Too many tags"),
    videoMetadata: videoMetadataSchema,
    transcript: z.array(transcriptSegmentSchema).optional(),
    transcriptText: z.string().optional(),
  }),
});

export const updateSummarySchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(1, "Title cannot be empty")
      .max(200, "Title too long")
      .optional(),
    keyPoints: z.array(z.string()).optional(),
    fullSummary: z
      .string()
      .min(1, "Summary cannot be empty")
      .max(5000, "Summary too long")
      .optional(),
    tags: z.array(z.string()).max(10, "Too many tags").optional(),
  }),
});

// Query parameter validation schemas
export const paginationSchema = z.object({
  query: z.object({
    page: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1))
      .default("1"),
    limit: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default("20"),
  }),
});

export const summaryQuerySchema = z.object({
  query: z.object({
    page: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1))
      .default("1")
      .optional(),
    limit: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default("20")
      .optional(),
    search: z.string().max(100).optional(),
    status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
    videoId: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    sortBy: z
      .enum(["createdAt", "title", "videoTitle"])
      .default("createdAt")
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
  }),
});

// Validation middleware factory
export const validate = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (!result.success) {
        const errors: ValidationError[] = result.error.errors.map((error) => ({
          field: error.path.join("."),
          message: error.message,
        }));

        const response: ApiResponse = {
          success: false,
          error: "Validation failed",
          data: { errors },
        };

        return res.status(400).json(response);
      }

      // Store validated data in req for later use (don't modify original req properties)
      (req as any).validatedData = result.data;

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const saveLinkedinPostSchema = z.object({
  body: z.object({
    title: z.string().max(500, "Title too long").optional(),
    content: z.string().min(1, "Content is required").max(10000, "Content too long"),
    author: z.string().min(1, "Author is required").max(200, "Author name too long"),
    postUrl: z.string().url("Invalid post URL"),
    linkedinPostId: z.string().optional(),
    platform: z.string().default("linkedin"),
    engagement: z.object({
      likes: z.number().min(0).optional(),
      comments: z.number().min(0).optional(),
      shares: z.number().min(0).optional(),
    }).optional(),
    metadata: z.object({
      timestamp: z.string().optional(),
      source: z.string().optional(),
    }).optional(),
  }),
});

export const updateLinkedinPostSchema = z.object({
  body: z.object({
    title: z.string().max(500, "Title too long").optional(),
    content: z.string().min(1, "Content cannot be empty").max(10000, "Content too long").optional(),
    author: z.string().min(1, "Author cannot be empty").max(200, "Author name too long").optional(),
    engagement: z.object({
      likes: z.number().min(0).optional(),
      comments: z.number().min(0).optional(),
      shares: z.number().min(0).optional(),
    }).optional(),
    metadata: z.object({
      timestamp: z.string().optional(),
      source: z.string().optional(),
    }).optional(),
  }),
});

export const linkedinPostQuerySchema = z.object({
  query: z.object({
    page: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1))
      .default("1")
      .optional(),
    limit: z
      .string()
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default("20")
      .optional(),
    search: z.string().max(100).optional(),
    author: z.string().max(200).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    sortBy: z
      .enum(["savedAt", "createdAt", "author", "title"])
      .default("savedAt")
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
  }),
});

export const createWebsiteSummarySchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(1, "Title is required")
      .max(500, "Title too long")
      .trim(),
    content: z
      .string()
      .min(100, "Content too short. Minimum 100 characters required for meaningful summarization.")
      .max(100000, "Content too long. Maximum 100,000 characters allowed.")
      .trim(),
    url: z
      .string()
      .url("Invalid URL format")
      .max(2000, "URL too long"),
  }),
});

export const getWebsiteSummarySchema = z.object({
  query: z.object({
    url: z
      .string()
      .url("Invalid URL format")
      .max(2000, "URL too long"),
  }),
});

// URL validation helper
export const validateWebsiteUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // Block localhost and private IP ranges for security
    const hostname = urlObj.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.20.') ||
      hostname.startsWith('172.21.') ||
      hostname.startsWith('172.22.') ||
      hostname.startsWith('172.23.') ||
      hostname.startsWith('172.24.') ||
      hostname.startsWith('172.25.') ||
      hostname.startsWith('172.26.') ||
      hostname.startsWith('172.27.') ||
      hostname.startsWith('172.28.') ||
      hostname.startsWith('172.29.') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.')
    ) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};