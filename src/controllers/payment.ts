import { Request, Response } from "express";
import { z } from "zod";
import { paymentService } from "../services/payment";
import { logger } from "../config/logger";
import {
  AuthenticatedRequest,
  CreateCheckoutSessionDto,
  DODOPaymentBilling,
  DODOWebhookEvent,
  ApiResponse,
} from "../types";

// Validation schemas
const createSubscriptionSchema = z.object({
  metadata: z.record(z.any()).optional(),
});

const webhookSchema = z.object({
  type: z.enum([
    "payment.succeeded",
    "payment.completed",
    "payment.failed",
    "subscription.created",
    "subscription.active",
    "subscription.cancelled",
    "subscription.payment_failed",
    "subscription.trial_ending",
    "subscription.renewed",
    "subscription.on_hold",
    "subscription.failed",
  ]),
  data: z
    .object({
      id: z.string().optional(),
      payment_id: z.string().optional(),
      subscription_id: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    })
    .passthrough(),
});

class PaymentController {
  /**
   * Create a subscription checkout session
   */
  async createSubscriptionCheckoutSession(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;
      const validation = createSubscriptionSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: "Invalid request data",
          details: validation.error.errors,
        } as ApiResponse);
        return;
      }

      const { metadata } = validation.data;

      logger.info("Creating subscription checkout session", {
        userId: user.id,
      });

      const result = await paymentService.createSubscriptionCheckoutSession(
        user,
        metadata
      );

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          sessionId: result.data?.session_id,
          paymentLink: result.data?.checkout_url,
          productType: "subscription",
        },
        message: "Subscription checkout session created successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error creating subscription checkout session", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to create subscription checkout session",
      } as ApiResponse);
    }
  }

  /**
   * Request subscription cancellation (sends email to admin)
   */
  async requestCancellation(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;

      logger.info("Processing subscription cancellation request", {
        userId: user.id,
      });

      const result = await paymentService.requestCancellation(user);

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        message:
          result.data?.message || "Cancellation request submitted successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error processing cancellation request", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to process cancellation request",
      } as ApiResponse);
    }
  }

  /**
   * Get user subscription status
   */
  async getSubscriptionStatus(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;

      logger.info("Getting subscription status", {
        userId: user.id,
      });

      const result = await paymentService.getUserSubscriptionStatus(user);

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
      } as ApiResponse);
    } catch (error) {
      logger.error("Error getting subscription status", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to get subscription status",
      } as ApiResponse);
    }
  }

  /**
   * Manual sync endpoint (for admin use)
   */
  async syncSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { subscriptionId } = req.params;
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          error: "Email required for sync",
        } as ApiResponse);
        return;
      }

      console.log(`🔄 Manual sync requested for: ${subscriptionId}`);

      const result = await paymentService.syncSubscription(
        subscriptionId,
        email
      );

      if (!result.success) {
        res.status(result.statusCode || 400).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
      } as ApiResponse);
    } catch (error) {
      console.error("Sync error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Handle success redirect from DodoPayments
   */
  async handleSuccessRedirect(req: Request, res: Response): Promise<void> {
    try {
      const { subscription_id, status } = req.query;

      if (subscription_id && status === "active") {
        await paymentService.handleSuccessRedirect(subscription_id as string);
      }

      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      res.redirect(
        `${frontendUrl}/success?subscription_id=${subscription_id}&status=${status}`
      );
    } catch (error) {
      logger.error("Error handling success redirect", { error });
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      res.redirect(`${frontendUrl}/error`);
    }
  }

  /**
   * Handle subscription webhook
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookId = req.headers["webhook-id"] as string;
      const webhookSignature = req.headers["webhook-signature"] as string;
      const webhookTimestamp = req.headers["webhook-timestamp"] as string;
      const payload = req.body;

      logger.info("Webhook received", {
        webhookId: webhookId ? "present" : "missing",
        signature: webhookSignature ? "present" : "missing",
        timestamp: webhookTimestamp ? "present" : "missing",
      });

      // CRITICAL: Verify webhook signature using Standard Webhooks spec
      if (!webhookId || !webhookSignature || !webhookTimestamp) {
        logger.error("Webhook missing required headers", {
          webhookId: !!webhookId,
          signature: !!webhookSignature,
          timestamp: !!webhookTimestamp,
        });
        res.status(401).json({ error: "Missing required webhook headers" });
        return;
      }

      // Verify signature using DodoPayments Standard Webhooks
      const webhookSecret = process.env.DODO_WEBHOOK_SECRET;
      if (!webhookSecret) {
        logger.error("Webhook secret not configured");
        res.status(500).json({ error: "Webhook secret not configured" });
        return;
      }

      try {
        // Standard Webhooks verification: webhook-id.webhook-timestamp.payload
        const payloadString = JSON.stringify(payload);
        const signedPayload = `${webhookId}.${webhookTimestamp}.${payloadString}`;

        const crypto = require("crypto");
        const expectedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(signedPayload, "utf8")
          .digest("base64");

        // DodoPayments sends signature in format: v1,signature1 v1,signature2
        const signatures = webhookSignature.split(" ");
        const isValidSignature = signatures.some((sig) => {
          const [version, signature] = sig.split(",");
          return version === "v1" && signature === expectedSignature;
        });

        if (!isValidSignature) {
          logger.error("Webhook signature verification failed");
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } catch (verifyError) {
        logger.error("Webhook signature verification error", {
          error: verifyError,
        });
        res.status(401).json({ error: "Signature verification failed" });
        return;
      }

      // Parse and validate payload
      let event;
      try {
        event = typeof payload === "string" ? JSON.parse(payload) : payload;
      } catch (parseError) {
        logger.error("Failed to parse webhook payload:", parseError);
        res.status(400).json({ error: "Invalid JSON payload" });
        return;
      }

      logger.info("Webhook event verified:", {
        type: event.type,
        webhookId,
        businessId: event.business_id,
      });

      // Validate webhook payload structure
      const validation = webhookSchema.safeParse(event);
      if (!validation.success) {
        logger.error("Invalid webhook payload", {
          errors: validation.error.errors,
          payload: event,
        });

        res.status(400).json({
          error: "Invalid webhook payload",
          details: validation.error.errors,
        });
        return;
      }

      // Process the webhook with deduplication
      const result = await paymentService.handleWebhook(
        event as DODOWebhookEvent,
        webhookId
      );

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          error: result.error,
        });
        return;
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("Webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
}

export const paymentController = new PaymentController();
