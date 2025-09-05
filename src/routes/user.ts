import { Router } from "express";
import { userController } from "../controllers/user";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { updateProfileSchema } from "../middleware/validation";

const router = Router();

// All user routes require authentication - NO RATE LIMITING
router.use(authenticate as any);

// Get user profile - NO RATE LIMITING
router.get("/profile", userController.getProfile);

// Update user profile - NO RATE LIMITING
router.put(
  "/profile",
  validate(updateProfileSchema) as any,
  userController.updateProfile
);

// Get user statistics - NO RATE LIMITING
router.get("/stats", userController.getStats);

// Add credits (for testing or admin purposes) - NO RATE LIMITING
router.post("/credits/add", userController.addCredits);

// Upgrade user plan - NO RATE LIMITING
router.post("/plan/upgrade", userController.upgradePlan);

// Verify email - NO RATE LIMITING
router.post("/verify-email", userController.verifyEmail);

// Delete user account - NO RATE LIMITING
router.delete("/account", userController.deleteAccount);

export default router;