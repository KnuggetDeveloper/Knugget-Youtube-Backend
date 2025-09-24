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
   * Cancel user's subscription
   */
  async cancelSubscription(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const user = req.user!;

      logger.info("Processing subscription cancellation request", {
        userId: user.id,
      });

      const result = await paymentService.cancelSubscription(user);

      if (!result.success) {
        res.status(result.statusCode || 500).json({
          success: false,
          error: result.error,
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Subscription will be cancelled at the end of the current billing period",
      } as ApiResponse);
    } catch (error) {
      logger.error("Error cancelling subscription", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        success: false,
        error: "Failed to cancel subscription",
      } as ApiResponse);
    }
  }

  /**
   * Handle subscription webhook
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature =
        req.headers["dodo-signature"] || req.headers["x-dodo-signature"];
      const payload = req.body;

      logger.info("Webhook received", {
        signature: signature ? "present" : "missing",
        payloadSize: payload.length,
      });

      // Verify webhook signature
      if (
        signature &&
        !paymentService.verifyWebhookSignature(
          payload.toString(),
          signature as string
        )
      ) {
        logger.error("Webhook signature verification failed");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Parse the payload
      let event;
      try {
        event = typeof payload === "string" ? JSON.parse(payload) : payload;
      } catch (parseError) {
        logger.error("Failed to parse webhook payload:", parseError);
        res.status(400).json({ error: "Invalid JSON payload" });
        return;
      }

      logger.info("Webhook event:", event.type, "for:", event.data?.id);
      logger.info("Event metadata:", event.data?.metadata);

      // Validate webhook payload
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

      // Process the webhook
      const result = await paymentService.handleWebhook(
        event as DODOWebhookEvent
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
