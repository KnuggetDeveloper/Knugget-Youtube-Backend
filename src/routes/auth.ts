import { Router } from "express";
import { authController } from "../controllers/auth";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
} from "../middleware/validation";

const router = Router();

// Public routes - NO RATE LIMITING
router.post(
  "/register",
  validate(registerSchema) as any,
  authController.register
);

router.post("/login", validate(loginSchema) as any, authController.login);

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema) as any,
  authController.forgotPassword
);

// Sync user from Firebase token (for users who signed up via client-side Firebase)
router.post("/sync", authController.syncUser);

// Protected routes - NO RATE LIMITING
router.use(authenticate as any);

router.post("/logout", authController.logout);

router.get("/me", authController.me);

router.post("/verify-email", authController.verifyEmail);

router.post("/revoke-all-tokens", authController.revokeAllTokens);

router.delete("/account", authController.deleteAccount);

export default router;
