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

/**
 * @route   POST /api/payment/test-webhook
 * @desc    Test webhook processing manually
 * @access  Public (for testing only)
 */
router.post("/test-webhook", async (req, res) => {
  try {
    // Sample subscription created event
    const testEvent = {
      type: "subscription.created",
      data: {
        id: "sub_test_123",
        subscription_id: "sub_test_123",
        metadata: {
          userId: req.body.userId, // Pass user ID in request body
        },
      },
    };

    const { paymentService } = require("../services/payment");
    const result = await paymentService.handleWebhook(testEvent);

    res.json({
      success: true,
      message: "Test webhook processed",
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
