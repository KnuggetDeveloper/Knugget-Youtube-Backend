import DodoPayments from "dodopayments";
import crypto from "crypto";
import { config } from "../config";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import {
  DODOCheckoutSessionResponse,
  DODOWebhookEvent,
  ServiceResponse,
  AuthUser,
  UserPlan,
} from "../types";

interface PaymentConfig {
  subscriptionProductId: string;
  frontendUrl: string;
}

class PaymentService {
  private client: DodoPayments;
  private paymentConfig: PaymentConfig;

  constructor() {
    // Initialize DODOpayment client
    this.client = new DodoPayments({
      bearerToken: config.payment.dodoApiKey,
      environment: config.payment.environment as "test_mode" | "live_mode",
    });

    // Payment configuration
    this.paymentConfig = {
      subscriptionProductId: config.payment.subscriptionProductId,
      frontendUrl: config.payment.frontendUrl,
    };

    logger.info("PaymentService initialized", {
      hasApiKey: !!config.payment.dodoApiKey,
      webhookSecret: !!config.payment.webhookSecret,
      environment: config.payment.environment,
      subscriptionProductId: this.paymentConfig.subscriptionProductId,
      frontendUrl: config.payment.frontendUrl,
    });
  }

  /**
   * Create a subscription checkout session
   */
  async createSubscriptionCheckoutSession(
    user: AuthUser,
    metadata?: Record<string, any>
  ): Promise<ServiceResponse<DODOCheckoutSessionResponse>> {
    try {
      logger.info("Creating subscription checkout session", {
        userId: user.id,
      });

      const checkoutData = {
        product_cart: [
          {
            product_id: this.paymentConfig.subscriptionProductId,
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 14, // 14-day free trial
        },
        show_saved_payment_methods: true,
        return_url: `${this.paymentConfig.frontendUrl}/success`,
        metadata: {
          source: "web_subscription",
          product_type: "subscription",
          userId: user.id,
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      };

      logger.info("Creating subscription checkout session with data", {
        userId: user.id,
        productId: this.paymentConfig.subscriptionProductId,
      });

      const session = await this.client.checkoutSessions.create(checkoutData);

      logger.info("Subscription checkout session created", {
        userId: user.id,
        sessionId: session.session_id,
        checkoutUrl: session.checkout_url,
      });

      return {
        success: true,
        data: session,
      };
    } catch (error) {
      logger.error("Failed to create subscription checkout session", {
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: "Failed to create subscription checkout session",
        statusCode: 500,
      };
    }
  }

  /**
   * Cancel a user's subscription
   */
  async cancelSubscription(user: AuthUser): Promise<ServiceResponse<void>> {
    try {
      logger.info("Cancelling subscription for user", {
        userId: user.id,
      });

      // Get user's subscription ID from database
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { subscriptionId: true, plan: true },
      });

      if (!userData?.subscriptionId) {
        logger.warn("No active subscription found for user", {
          userId: user.id,
        });
        return {
          success: false,
          error: "No active subscription found",
          statusCode: 404,
        };
      }

      if (userData.plan !== UserPlan.PREMIUM) {
        logger.warn("User is not on premium plan", {
          userId: user.id,
          currentPlan: userData.plan,
        });
        return {
          success: false,
          error: "No premium subscription to cancel",
          statusCode: 400,
        };
      }

      // Cancel subscription with DodoPayments
      logger.info("Cancelling subscription with DodoPayments", {
        userId: user.id,
        subscriptionId: userData.subscriptionId,
      });

      const cancelledSubscription = await this.client.subscriptions.update(
        userData.subscriptionId,
        {
          cancel_at_next_billing_date: true,
        }
      );

      logger.info("Subscription cancelled successfully", {
        userId: user.id,
        subscriptionId: userData.subscriptionId,
        cancelAtNextBilling: cancelledSubscription.cancel_at_next_billing_date,
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to cancel subscription", {
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: "Failed to cancel subscription",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle subscription webhook events
   */
  async handleWebhook(event: DODOWebhookEvent): Promise<ServiceResponse<void>> {
    try {
      logger.info("Processing subscription webhook", {
        type: event.type,
        id: event.data?.id,
        metadata: event.data?.metadata,
      });

      switch (event.type) {
        case "payment.succeeded":
        case "payment.completed":
          logger.info("Subscription payment successful:", event.data?.id);
          await this.handlePaymentSucceeded(event);
          break;
        case "payment.failed":
          logger.info("Subscription payment failed:", event.data?.id);
          await this.handlePaymentFailed(event);
          break;
        case "subscription.created":
          logger.info("New subscription created:", event.data?.id);
          await this.handleSubscriptionCreated(event);
          break;
        case "subscription.active":
          logger.info("Subscription is active:", event.data?.id);
          await this.handleSubscriptionActive(event);
          break;
        case "subscription.cancelled":
          logger.info("Subscription cancelled:", event.data?.id);
          await this.handleSubscriptionCancelled(event);
          break;
        case "subscription.payment_failed":
          logger.info("Recurring payment failed:", event.data?.id);
          await this.handleSubscriptionPaymentFailed(event);
          break;
        case "subscription.trial_ending":
          logger.info("Trial ending soon:", event.data?.id);
          await this.handleTrialEnding(event);
          break;
        default:
          logger.info("Unhandled webhook event type:", event.type);
      }

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to handle webhook", {
        type: event.type,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: "Failed to handle webhook",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle successful subscription payment
   */
  private async handlePaymentSucceeded(event: DODOWebhookEvent): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;

    if (!userId) {
      logger.warn("Subscription payment succeeded but no userId in metadata", {
        paymentId: event.data.payment_id,
      });
      return;
    }

    try {
      // Grant/renew access to subscription features
      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: UserPlan.PREMIUM,
          credits: { increment: 1000 }, // Add premium credits
        },
      });

      logger.info("User subscription payment successful", {
        userId,
        paymentId: event.data.payment_id,
      });
    } catch (error) {
      logger.error("Failed to process successful subscription payment", {
        userId,
        paymentId: event.data.payment_id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Handle failed subscription payment
   */
  private async handlePaymentFailed(event: DODOWebhookEvent): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;

    if (userId) {
      logger.warn("Subscription payment failed for user", {
        userId,
        paymentId: event.data.payment_id,
      });
      // Maybe send notification to customer
    }
  }

  /**
   * Handle new subscription created
   */
  private async handleSubscriptionCreated(
    event: DODOWebhookEvent
  ): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;
    const subscriptionId = event.data.subscription_id;

    if (!userId) {
      logger.warn("Subscription created but no userId in metadata", {
        subscriptionId,
      });
      return;
    }

    try {
      // Grant access to subscription features and store subscription ID
      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: UserPlan.PREMIUM,
          credits: { increment: 1000 }, // Add premium credits
          subscriptionId, // Store DodoPayments subscription ID
        },
      });

      logger.info("New subscription activated for user", {
        userId,
        subscriptionId,
      });
      // Send welcome email
    } catch (error) {
      logger.error("Failed to activate new subscription", {
        userId,
        subscriptionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Handle subscription active status
   */
  private async handleSubscriptionActive(
    event: DODOWebhookEvent
  ): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;
    const subscriptionId = event.data.subscription_id;

    if (!userId) {
      logger.warn("Subscription active but no userId in metadata", {
        subscriptionId,
      });
      return;
    }

    try {
      // Ensure user has access to subscription features and store subscription ID
      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: UserPlan.PREMIUM,
          credits: { increment: 1000 }, // Add premium credits
          subscriptionId, // Store DodoPayments subscription ID
        },
      });

      logger.info("Subscription confirmed active for user", {
        userId,
        subscriptionId,
      });
    } catch (error) {
      logger.error("Failed to process active subscription", {
        userId,
        subscriptionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Handle subscription payment failed
   */
  private async handleSubscriptionPaymentFailed(
    event: DODOWebhookEvent
  ): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;

    if (userId) {
      logger.warn("Recurring payment failed for user", {
        userId,
        subscriptionId: event.data.subscription_id,
      });
      // Maybe send dunning email
    }
  }

  /**
   * Handle trial ending
   */
  private async handleTrialEnding(event: DODOWebhookEvent): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;

    if (userId) {
      logger.info("Trial ending soon for user", {
        userId,
        subscriptionId: event.data.subscription_id,
      });
      // Send trial ending notification
    }
  }

  /**
   * Handle subscription cancellation
   */
  private async handleSubscriptionCancelled(
    event: DODOWebhookEvent
  ): Promise<void> {
    const { metadata } = event.data;
    const userId = metadata?.userId;
    const subscriptionId = event.data.subscription_id;

    if (!userId) {
      logger.warn("Subscription cancelled but no userId in metadata", {
        subscriptionId,
      });
      return;
    }

    try {
      // Revoke access to subscription features and clear subscription ID
      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: UserPlan.FREE,
          credits: 10, // Reset to free tier credits
          subscriptionId: null, // Clear the subscription ID
        },
      });

      logger.info("User subscription cancelled", {
        userId,
        subscriptionId,
      });
      // Send cancellation confirmation
    } catch (error) {
      logger.error("Failed to handle subscription cancellation", {
        userId,
        subscriptionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Verify webhook signature using DODOpayment's signature verification
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      if (!config.payment.webhookSecret) {
        logger.error("Webhook secret not configured");
        return false;
      }

      // Verify webhook signature
      if (signature && config.payment.webhookSecret) {
        const expectedSignature = crypto
          .createHmac("sha256", config.payment.webhookSecret)
          .update(payload)
          .digest("hex");

        const providedSignature = (signature as string).replace("sha256=", "");

        if (expectedSignature !== providedSignature) {
          logger.error("Webhook signature verification failed");
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error("Webhook signature verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }
}

export const paymentService = new PaymentService();
