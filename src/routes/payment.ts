import { Router } from "express";
import { paymentController } from "../controllers/payment";
import { authenticate } from "../middleware/auth";

const router = Router();

/**
 * @route   POST /api/payment/create-payment
 * @desc    Create a subscription checkout session
 * @access  Private (requires authentication)
 * @body    {
 *           metadata?: Record<string, any>
 *         }
 */
router.post(
  "/create-payment",
  authenticate,
  paymentController.createSubscriptionCheckoutSession.bind(paymentController)
);

/**
 * @route   POST /api/payment/cancel-subscription
 * @desc    Cancel user's subscription
 * @access  Private (requires authentication)
 */
router.post(
  "/cancel-subscription",
  authenticate,
  paymentController.cancelSubscription.bind(paymentController)
);

/**
 * @route   POST /api/payment/webhook
 * @desc    Handle DODOpayment subscription webhook events
 * @access  Public (webhook endpoint)
 * @headers dodo-signature OR x-dodo-signature: string (webhook signature)
 * @body    DODOWebhookEvent
 */
router.post(
  "/webhook",
  // Note: No authentication middleware for webhooks
  paymentController.handleWebhook.bind(paymentController)
);

export default router;
