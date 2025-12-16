import { Router } from "express";
import { websiteSummaryController } from "../controllers/website";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { createWebsiteSummarySchema } from "../middleware/validation";
import { catchAsync } from "../middleware/errorHandler";

const router = Router();

// Health check endpoint (no auth required)
router.get("/health", websiteSummaryController.healthCheck);

// All other website routes require authentication
router.use(authenticate as any);

// Create or get existing website summary (extended timeout for AI processing)
router.post(
  "/",
  validate(createWebsiteSummarySchema) as any,
  catchAsync(websiteSummaryController.createOrGetSummary, 120000) // 2 minute timeout
);

// Get user's website summaries with pagination
router.get("/", websiteSummaryController.getSummaries);

// Get website summary statistics
router.get("/stats", websiteSummaryController.getStats);

// Get summary by URL
router.get("/by-url", websiteSummaryController.getSummaryByUrl);

// Get single summary by ID
router.get("/:id", websiteSummaryController.getSummaryById);

// Delete a website summary
router.delete("/:id", websiteSummaryController.deleteSummary);

export default router;

