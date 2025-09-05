import { Router } from 'express';
import { summaryController } from '../controllers/summary';
import { authenticate, requireCredits } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  generateSummarySchema,
  saveSummarySchema,
  updateSummarySchema,
} from '../middleware/validation';
import { config } from '../config';

const router = Router();

// All summary routes require authentication - NO RATE LIMITING
router.use(authenticate as any);

// Generate AI summary from transcript - NO RATE LIMITING
router.post(
  '/generate',
  requireCredits(config.credits.perSummary) as any,
  // Remove the validate middleware temporarily or update the schema
  summaryController.generate
);

// Save summary - NO RATE LIMITING
router.post(
  '/save',
  validate(saveSummarySchema) as any,
  summaryController.save
);

// Get user's summaries with pagination and filtering - NO RATE LIMITING
router.get(
  '/',
  summaryController.getSummaries
);

// Get summary statistics - NO RATE LIMITING
router.get(
  '/stats',
  summaryController.getStats
);

// Get single summary by ID - NO RATE LIMITING
router.get(
  '/:id',
  summaryController.getSummaryById
);

// Update summary - NO RATE LIMITING
router.put(
  "/:id",
  validate(updateSummarySchema) as any,
  summaryController.updateSummary
);

// Delete summary - NO RATE LIMITING
router.delete(
  '/:id',
  summaryController.deleteSummary
);

// Get summary by video ID - NO RATE LIMITING
router.get(
  '/video/:videoId',
  summaryController.getSummaryByVideoId
);

export default router;