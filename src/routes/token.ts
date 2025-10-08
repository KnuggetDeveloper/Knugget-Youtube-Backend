import { Router } from "express";
import { tokenController } from "../controllers/token";
import { authenticate } from "../middleware/auth";

const router = Router();

// User endpoints (require authentication)
router.get("/status", authenticate, tokenController.getTokenStatus);
router.post(
  "/check-availability",
  authenticate,
  tokenController.checkTokenAvailability
);

// Admin endpoints (require authentication - add admin middleware if needed)
router.post(
  "/initialize/:userId",
  authenticate,
  tokenController.initializePremiumTokens
);
router.post("/reset/:userId", authenticate, tokenController.resetTokens);
router.post("/reset-all", authenticate, tokenController.resetAllPremiumTokens);

export default router;
