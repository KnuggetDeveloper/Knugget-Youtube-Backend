import { Router } from "express";
import { infographicController } from "../controllers/infographic";
import { authenticate } from "../middleware/auth";

const router = Router();

// All infographic routes require authentication
router.use(authenticate as any);

// Generate infographic from summary transcript
router.post("/generate", infographicController.generateInfographic);

// Get image generation statistics
router.get("/stats", infographicController.getStats);

// Get image generation usage history
router.get("/usage", infographicController.getUsage);

export default router;

