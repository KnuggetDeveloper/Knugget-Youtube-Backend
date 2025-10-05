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
 * @route   POST /api/payment/request-cancellation
 * @desc    Request subscription cancellation (sends email to admin)
 * @access  Private (requires authentication)
 */
router.post(
  "/request-cancellation",
  authenticate,
  paymentController.requestCancellation.bind(paymentController)
);

/**
 * @route   GET /api/payment/subscription-status
 * @desc    Get user's subscription status
 * @access  Private (requires authentication)
 */
router.get(
  "/subscription-status",
  authenticate,
  paymentController.getSubscriptionStatus.bind(paymentController)
);

/**
 * @route   GET /api/payment/success
 * @desc    Handle success redirect from DodoPayments
 * @access  Public
 */
router.get(
  "/success",
  paymentController.handleSuccessRedirect.bind(paymentController)
);

/**
 * @route   POST /api/payment/sync-subscription/:subscriptionId
 * @desc    Manual sync subscription (for admin use)
 * @access  Public (admin endpoint)
 */
router.post(
  "/sync-subscription/:subscriptionId",
  paymentController.syncSubscription.bind(paymentController)
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
