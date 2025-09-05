import { Router } from "express";
import { authController } from "../controllers/auth";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../middleware/validation";

const router = Router();

// Public routes - NO RATE LIMITING
router.post(
  "/register",
  validate(registerSchema) as any,
  authController.register
);

router.post(
  "/login",
  validate(loginSchema) as any,
  authController.login
);

router.post(
  "/refresh",
  validate(refreshTokenSchema) as any,
  authController.refresh
);

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema) as any,
  authController.forgotPassword
);

router.post(
  "/reset-password",
  validate(resetPasswordSchema) as any,
  authController.resetPassword
);

router.post(
  "/verify-email",
  validate(verifyEmailSchema) as any,
  authController.verifyEmail
);

// Protected routes - NO RATE LIMITING
router.use(authenticate as any);

router.post(
  "/logout",
  validate(refreshTokenSchema) as any,
  authController.logout
);

router.get("/me", authController.me);

router.post("/revoke-all-tokens", authController.revokeAllTokens);

export default router;