import { PrismaClient, UserPlan } from "@prisma/client";
import { config } from "../config";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { ServiceResponse, AuthUser, DODOWebhookEvent } from "../types";
import { tokenService } from "./token";

interface PaymentConfig {
  subscriptionProductId: string;
  frontendUrl: string;
}

class PaymentService {
  private DODO_API_KEY = config.payment.dodoApiKey;
  private DODO_BASE_URL = config.payment.dodoBaseUrl;
  private paymentConfig: PaymentConfig;
  private processedWebhooks = new Set<string>(); // Deduplication by webhook-id

  constructor() {
    this.paymentConfig = {
      subscriptionProductId: config.payment.subscriptionProductId,
      frontendUrl: config.payment.frontendUrl,
    };

    logger.info("PaymentService initialized", {
      hasApiKey: !!this.DODO_API_KEY,
      baseUrl: this.DODO_BASE_URL,
      subscriptionProductId: this.paymentConfig.subscriptionProductId,
      frontendUrl: this.paymentConfig.frontendUrl,
    });
  }

  /**
   * Helper: Sync subscription from DodoPayments and update DB
   */
  async syncSubscriptionFromDodo(subscriptionId: string, email: string) {
    try {
      console.log(`🔄 Syncing subscription ${subscriptionId} for ${email}`);

      const response = await fetch(
        `${this.DODO_BASE_URL}/subscriptions/${subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${this.DODO_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error("Failed to fetch from DodoPayments");
        return null;
      }

      const subscription = await response.json();
      const dodoStatus = subscription.status;
      const cancelAtNext = subscription.cancel_at_next_billing_date;
      const nextBilling = new Date(subscription.next_billing_date);
      const now = new Date();

      // Determine user status based on DodoPayments response
      let isPremium = false;
      let dbStatus = "free";
      let dbPlan: UserPlan = UserPlan.FREE;

      // Scenario 1: Active subscription
      if (dodoStatus === "active" && !cancelAtNext) {
        isPremium = true;
        dbStatus = "active";
        dbPlan = UserPlan.PREMIUM;
        console.log("✅ Status: ACTIVE - Full premium access");
      }
      // Scenario 2: Cancelling (grace period)
      else if (dodoStatus === "active" && cancelAtNext) {
        // Check if still in grace period
        isPremium = nextBilling > now;
        dbStatus = isPremium ? "cancelling" : "expired";
        dbPlan = isPremium ? UserPlan.PREMIUM : UserPlan.FREE;
        console.log(
          `⚠️ Status: CANCELLING - Premium until ${nextBilling.toLocaleDateString()}`
        );
      }
      // Scenario 3: Cancelled immediately
      else if (dodoStatus === "cancelled") {
        isPremium = false;
        dbStatus = "expired";
        dbPlan = UserPlan.FREE;
        console.log("❌ Status: CANCELLED - No premium access");
      }
      // Other statuses (pending, paused, etc.)
      else {
        isPremium = false;
        dbStatus = dodoStatus || "free";
        dbPlan = UserPlan.FREE;
        console.log(`📊 Status: ${dodoStatus.toUpperCase()}`);
      }

      console.log(`Final: ${email} → ${dbStatus} (premium: ${isPremium})`);

      // Update database
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          subscriptionId,
          plan: dbPlan,
          subscriptionStatus: dbStatus,
          nextBillingDate: subscription.next_billing_date
            ? new Date(subscription.next_billing_date)
            : null,
          cancelAtBillingDate: cancelAtNext,
          updatedAt: new Date(),
        },
      });

      // Initialize premium tokens if user is now premium
      if (dbPlan === UserPlan.PREMIUM && isPremium) {
        try {
          const billingEndDate = subscription.next_billing_date
            ? new Date(subscription.next_billing_date)
            : undefined;
          await tokenService.initializePremiumTokens(
            updatedUser.id,
            billingEndDate
          );
        } catch (tokenError) {
          logger.error("Failed to initialize premium tokens during sync", {
            userId: updatedUser.id,
            email,
            error: tokenError,
          });
        }
      }

      // Return both DB data and full DodoPayments response
      return {
        user: updatedUser,
        dodoPaymentsResponse: subscription,
      };
    } catch (error) {
      console.error("Sync error:", error);
      return null;
    }
  }

  /**
   * Create subscription
   */
  async createSubscriptionCheckoutSession(
    user: AuthUser,
    metadata?: Record<string, any>
  ): Promise<ServiceResponse<any>> {
    try {
      console.log("📝 Creating subscription for:", {
        userId: user.id,
        email: user.email,
        name: user.name,
      });

      if (!user.id || !user.email || !user.name) {
        return {
          success: false,
          error: "User ID, email, and name are required",
          statusCode: 400,
        };
      }

      const productId = this.paymentConfig.subscriptionProductId;
      if (!productId || productId.trim() === "") {
        return {
          success: false,
          error: "Product ID is required",
          statusCode: 400,
        };
      }

      console.log("🚀 Creating checkout with DodoPayments...");

      // Create checkout session
      const response = await fetch(`${this.DODO_BASE_URL}/checkouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.DODO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_cart: [
            {
              product_id: productId.trim(),
              quantity: 1,
            },
          ],
          customer: { name: user.name, email: user.email },
          return_url: `${this.paymentConfig.frontendUrl}/success`,
        }),
      });

      const data = await response.json();

      console.log("📊 DodoPayments response status:", response.status);
      console.log(
        "📊 DodoPayments response data:",
        JSON.stringify(data, null, 2)
      );

      if (response.ok) {
        console.log("✅ Checkout created successfully");

        // Save to database
        await prisma.user.update({
          where: { id: user.id },
          data: {
            updatedAt: new Date(),
          },
        });

        return {
          success: true,
          data: {
            checkout_url: data.checkout_url,
            session_id: data.session_id,
          },
        };
      } else {
        console.error("❌ DodoPayments error:", data);
        return {
          success: false,
          error: data,
          statusCode: 400,
        };
      }
    } catch (error) {
      console.error("💥 Server error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        statusCode: 500,
      };
    }
  }

  /**
   * Get user subscription status (with auto-sync if needed)
   */
  async getUserSubscriptionStatus(
    user: AuthUser
  ): Promise<ServiceResponse<any>> {
    try {
      // Get user from database
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          subscriptionId: true,
          plan: true,
          email: true,
          nextBillingDate: true,
          subscriptionStatus: true,
          cancelAtBillingDate: true,
        },
      });

      if (!userData || !userData.subscriptionId) {
        return {
          success: true,
          data: {
            subscription: null,
            message: "No active subscription",
          },
        };
      }

      // Check if billing date passed - if yes, sync from DodoPayments
      const now = new Date();
      const billingDate = userData.nextBillingDate
        ? new Date(userData.nextBillingDate)
        : null;

      if (billingDate && billingDate <= now) {
        console.log(`🔄 Billing date passed for ${userData.email}, syncing...`);
        const synced = await this.syncSubscriptionFromDodo(
          userData.subscriptionId,
          userData.email
        );

        if (synced) {
          // Return ORIGINAL DodoPayments response
          return {
            success: true,
            data: {
              subscription: synced.dodoPaymentsResponse,
              synced: true,
              message: "Subscription synced from DodoPayments",
            },
          };
        }
      }

      // Fetch current status from DodoPayments (always return fresh data)
      const response = await fetch(
        `${this.DODO_BASE_URL}/subscriptions/${userData.subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${this.DODO_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: "Failed to fetch subscription",
          statusCode: 400,
        };
      }

      const subscription = await response.json();

      // Return ORIGINAL DodoPayments response
      return {
        success: true,
        data: {
          subscription: subscription,
          synced: false,
          message: "Current subscription status",
          isPremium: subscription.status === "active",
          status: subscription.status,
          nextBillingDate: subscription.next_billing_date,
          cancelAtBillingDate: subscription.cancel_at_next_billing_date,
          subscriptionId: userData.subscriptionId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        statusCode: 500,
      };
    }
  }

  /**
   * Request subscription cancellation (sends email to admin)
   */
  async requestCancellation(user: AuthUser): Promise<ServiceResponse<any>> {
    try {
      logger.info("Processing cancellation request for user", {
        userId: user.id,
      });

      // Get user's subscription data
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          subscriptionId: true,
          plan: true,
          email: true,
          name: true,
          subscriptionStatus: true,
          nextBillingDate: true,
          cancelAtBillingDate: true,
        },
      });

      if (!userData?.subscriptionId || userData.plan !== UserPlan.PREMIUM) {
        return {
          success: false,
          error: "No active subscription found",
          statusCode: 404,
        };
      }

      // Get subscription details from DodoPayments
      const response = await fetch(
        `${this.DODO_BASE_URL}/subscriptions/${userData.subscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${this.DODO_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: "Failed to fetch subscription details",
          statusCode: 400,
        };
      }

      const subscription = await response.json();

      // Mark as cancellation requested in database
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: "cancellation_requested",
          updatedAt: new Date(),
        },
      });

      // Console log for admin (in production, send email)
      console.log(`
🚨 SUBSCRIPTION CANCELLATION REQUEST
=====================================
User: ${userData.name} (${userData.email})
User ID: ${user.id}
Subscription ID: ${userData.subscriptionId}
Next Billing: ${
        subscription.next_billing_date
          ? new Date(subscription.next_billing_date).toLocaleDateString()
          : "Unknown"
      }
Requested At: ${new Date().toLocaleString()}

ACTION REQUIRED: Please cancel this subscription in DodoPayments dashboard.
User will keep premium access until next billing date.
=====================================
      `);

      return {
        success: true,
        data: {
          message:
            "Cancellation request submitted. You will keep premium access until your next billing date. We will process your request within 24 hours.",
          nextBillingDate: subscription.next_billing_date,
        },
      };
    } catch (error) {
      logger.error("Failed to process cancellation request", {
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: "Failed to process cancellation request",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle webhook events with proper deduplication
   */
  async handleWebhook(
    event: DODOWebhookEvent,
    webhookId: string
  ): Promise<ServiceResponse<void>> {
    try {
      // Deduplication: Use webhook-id to prevent duplicate processing
      if (this.processedWebhooks.has(webhookId)) {
        console.log(`⚠️ Webhook ${webhookId} already processed, skipping`);
        return { success: true };
      }

      this.processedWebhooks.add(webhookId);

      // Auto-cleanup after 24 hours (DodoPayments retry window)
      setTimeout(() => {
        this.processedWebhooks.delete(webhookId);
      }, 24 * 60 * 60 * 1000);

      console.log("=== WEBHOOK RECEIVED ===");
      console.log("Event Type:", event.type);
      console.log("Webhook ID:", webhookId);
      console.log("Subscription ID:", event.data?.subscription_id);
      console.log("Customer Email:", event.data?.customer?.email);
      console.log("Status:", event.data?.status);
      console.log("======================");

      const subscriptionId = event.data?.subscription_id;
      const customerEmail = event.data?.customer?.email;

      if (!subscriptionId || !customerEmail) {
        return { success: true };
      }

      // Sync from DodoPayments
      await this.syncSubscriptionFromDodo(subscriptionId, customerEmail);

      return { success: true };
    } catch (error) {
      console.error("Webhook error:", error);
      // Remove from processed set on error so it can be retried
      this.processedWebhooks.delete(webhookId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle success redirect
   */
  async handleSuccessRedirect(subscriptionId: string): Promise<void> {
    try {
      console.log("Success redirect:", { subscriptionId });

      if (subscriptionId) {
        const response = await fetch(
          `${this.DODO_BASE_URL}/subscriptions/${subscriptionId}`,
          {
            headers: { Authorization: `Bearer ${this.DODO_API_KEY}` },
          }
        );

        if (response.ok) {
          const subscription = await response.json();
          const customerEmail = subscription.customer?.email;

          if (customerEmail) {
            await this.syncSubscriptionFromDodo(subscriptionId, customerEmail);
            console.log("Subscription activated via redirect:", subscriptionId);
          }
        }
      }
    } catch (error) {
      console.error("Error in success redirect:", error);
    }
  }

  /**
   * Manual sync endpoint (for admin use)
   */
  async syncSubscription(
    subscriptionId: string,
    email: string
  ): Promise<ServiceResponse<any>> {
    try {
      console.log(`🔄 Manual sync requested for: ${subscriptionId}`);

      const synced = await this.syncSubscriptionFromDodo(subscriptionId, email);

      if (!synced) {
        return {
          success: false,
          error: "Failed to sync subscription",
          statusCode: 400,
        };
      }

      return {
        success: true,
        data: {
          message: `Subscription synced: ${synced.user.subscriptionStatus}`,
          subscription: synced.dodoPaymentsResponse,
        },
      };
    } catch (error) {
      console.error("Sync error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        statusCode: 500,
      };
    }
  }
}

export const paymentService = new PaymentService();
