import { Request } from "express";
import { User, UserPlan, SummaryStatus } from "@prisma/client";

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Auth Types
export interface AuthUser
  extends Omit<User, "createdAt" | "updatedAt" | "lastLoginAt"> {
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Request Extensions
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// Summary Types
export interface TranscriptSegment {
  timestamp: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  channelName: string;
  duration?: string;
  url: string;
  thumbnailUrl?: string;
  description?: string;
  publishedAt?: string;
  viewCount?: number;
  likeCount?: number;
}

export interface SummaryData {
  id: string;
  title: string;
  keyPoints: string[];
  fullSummary: string;
  tags: string[];
  status: SummaryStatus;
  videoId: string;
  videoTitle: string;
  channelName: string;
  videoDuration?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  transcript?: TranscriptSegment[];
  transcriptText?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  isUnsaved?: boolean; // Flag to indicate if summary hasn't been saved to database yet
}

export interface GenerateSummaryRequest {
  transcript: TranscriptSegment[];
  videoMetadata: VideoMetadata;
}

export interface OpenAISummaryResponse {
  keyPoints: string[];
  fullSummary: string;
  tags: string[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface OpenAIUsageData {
  id: string;
  userId: string;
  operation: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  videoId?: string;
  summaryId?: string;
  createdAt: string;
}

// User Types
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  plan: UserPlan;
  subscriptionId: string | null;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  // Token management and video limits
  videosProcessedThisMonth?: number;
  videoResetDate?: string | null;
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
  tokenResetDate?: string | null;
}

export interface UserStats {
  totalSummaries: number;
  summariesThisMonth: number;
  videosProcessed: number;
  videoLimit: number;
  videosRemaining: number;
  planStatus: UserPlan;
  joinedDate: string;
  // OpenAI Usage stats
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  // Token stats per plan
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
  tokenResetDate?: string | null;
}

// Validation Schemas (DTOs)
export interface RegisterDto {
  email: string;
  password: string;
  name?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
}

export interface VerifyEmailDto {
  token: string;
}

export interface UpdateProfileDto {
  name?: string;
  avatar?: string;
}

export interface GenerateSummaryDto {
  transcript: TranscriptSegment[];
  videoMetadata: VideoMetadata;
}

export interface UpdateSummaryDto {
  title?: string;
  keyPoints?: string[];
  fullSummary?: string;
  tags?: string[];
}

// Error Types
export interface ValidationError {
  field: string;
  message: string;
}

export interface ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  errors?: ValidationError[];
}

// Utility Types
export type CreateUserData = Omit<User, "id" | "createdAt" | "updatedAt"> & {
  firebaseUid: string;
};
export type UpdateUserData = Partial<
  Pick<User, "name" | "avatar" | "plan" | "emailVerified" | "lastLoginAt">
>;

export type CreateSummaryData = {
  title: string;
  keyPoints: string[];
  fullSummary: string;
  tags: string[];
  videoId: string;
  videoTitle: string;
  channelName: string;
  videoDuration?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  transcript?: any;
  transcriptText?: string;
  userId: string;
  status?: SummaryStatus;
  isUnsaved?: boolean; // Flag indicating if this was generated but not yet saved (extension use)
};

// Query Parameters
export interface SummaryQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: SummaryStatus;
  videoId?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: "createdAt" | "title" | "videoTitle";
  sortOrder?: "asc" | "desc";
}

export interface UserQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  plan?: UserPlan;
  emailVerified?: boolean;
  sortBy?: "createdAt" | "email" | "name";
  sortOrder?: "asc" | "desc";
}

// Service Response Types
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

// Constants
export const MAX_TRANSCRIPT_LENGTH = 50000; // chars
export const MAX_SUMMARY_HISTORY = 100; // per user
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// DODOpayment Types
export interface DODOPaymentProduct {
  product_id: string;
  quantity: number;
}

export interface DODOPaymentCustomer {
  customer_id?: string;
  email?: string;
  name?: string;
  phone_number?: string;
}

export interface DODOPaymentBilling {
  street: string;
  city: string;
  state: string;
  country: string;
  zipcode: string | number;
}

export interface DODOCheckoutSessionRequest {
  product_cart: DODOPaymentProduct[];
  customer?: DODOPaymentCustomer;
  billing_address?: DODOPaymentBilling;
  return_url?: string;
  metadata?: Record<string, any>;
  payment_link?: boolean;
  allowed_payment_method_types?: string[];
}

export interface DODOCheckoutSessionResponse {
  session_id: string;
  checkout_url: string;
}

export interface DODOOneTimePaymentRequest {
  billing: DODOPaymentBilling;
  customer: DODOPaymentCustomer;
  product_cart: DODOPaymentProduct[];
  return_url?: string;
  metadata?: Record<string, any>;
  payment_link?: boolean;
  allowed_payment_method_types?: string[];
}

export interface DODOOneTimePaymentResponse {
  payment_id: string;
  client_secret: string;
  customer: DODOPaymentCustomer;
  metadata: Record<string, any>;
  total_amount: number;
  payment_link?: string;
  expires_on?: string;
}

export interface DODOSubscriptionRequest {
  billing: DODOPaymentBilling;
  customer: DODOPaymentCustomer;
  product_id: string;
  quantity: number;
  return_url?: string;
  metadata?: Record<string, any>;
  payment_link?: boolean;
  allowed_payment_method_types?: string[];
  trial_period_days?: number;
}

export interface DODOSubscriptionResponse {
  subscription_id: string;
  payment_id: string;
  customer: DODOPaymentCustomer;
  metadata: Record<string, any>;
  recurring_pre_tax_amount: number;
  payment_link?: string;
  expires_on?: string;
  client_secret?: string;
}

export interface DODOWebhookEvent {
  type:
    | "payment.succeeded"
    | "payment.completed"
    | "payment.failed"
    | "subscription.created"
    | "subscription.active"
    | "subscription.cancelled"
    | "subscription.payment_failed"
    | "subscription.trial_ending"
    | "subscription.renewed"
    | "subscription.on_hold"
    | "subscription.failed";
  data: {
    id?: string;
    payment_id?: string;
    subscription_id?: string;
    customer?: DODOPaymentCustomer;
    amount?: number;
    currency?: string;
    status?: string;
    metadata?: Record<string, any>;
    [key: string]: any;
  };
}

export interface CreateCheckoutSessionDto {
  type: "one_time" | "subscription";
  product_id: string;
  quantity?: number;
  return_url?: string;
  metadata?: Record<string, any>;
}

export interface PaymentWebhookDto {
  event: DODOWebhookEvent;
  signature: string;
}

// Re-export Prisma types
export {
  User,
  UserPlan,
  SummaryStatus,
  Summary,
  RefreshToken,
  VideoMetadata as PrismaVideoMetadata,
} from "@prisma/client";
