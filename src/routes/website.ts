// src/routes/website.ts
import { Router } from "express";
import { websiteSummaryController } from "../controllers/website";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  createWebsiteSummarySchema,
  getWebsiteSummarySchema,
} from "../middleware/validation";

const router = Router();

// All website summary routes require authentication
router.use(authenticate as any);

// Health check endpoint
router.get("/health", websiteSummaryController.healthCheck);

// Create or get website summary
// POST /api/website
router.post(
  "/",
  validate(createWebsiteSummarySchema) as any,
  websiteSummaryController.createSummary
);

// Get existing summary by URL
// GET /api/website?url=https://example.com/article
router.get(
  "/",
  validate(getWebsiteSummarySchema) as any,
  websiteSummaryController.getSummaryByUrl
);

export default router;

