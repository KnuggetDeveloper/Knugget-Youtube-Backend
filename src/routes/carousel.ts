import { Router } from "express";
import { carouselController } from "../controllers/carousel";
import { authenticate } from "../middleware/auth";

const router = Router();

// Apply authentication middleware to all carousel routes
router.use(authenticate as any);

// POST /api/carousel/generate - Generate carousel slides
router.post("/generate", carouselController.generateCarousel);

// GET /api/carousel/:summaryId - Get existing carousel slides
router.get("/:summaryId", carouselController.getCarouselSlides);

export default router;

