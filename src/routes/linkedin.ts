import { Router } from "express";
import { linkedinController } from "../controllers/linkedin";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  saveLinkedinPostSchema,
  updateLinkedinPostSchema,
} from "../middleware/validation";

const router = Router();

// All LinkedIn routes require authentication
router.use(authenticate as any);

// Save a LinkedIn post
router.post(
  "/",
  validate(saveLinkedinPostSchema) as any,
  linkedinController.savePost
);

// Get user's LinkedIn posts with pagination and filtering
router.get("/", linkedinController.getPosts);

// Get LinkedIn post statistics
router.get("/stats", linkedinController.getStats);

// Check if post exists by URL
router.get("/check", linkedinController.checkPostExists);

// Bulk delete LinkedIn posts
router.delete("/bulk", linkedinController.bulkDeletePosts);

// Get single LinkedIn post by ID
router.get("/:id", linkedinController.getPostById);

// Update a LinkedIn post
router.put(
  "/:id",
  validate(updateLinkedinPostSchema) as any,
  linkedinController.updatePost
);

// Delete a LinkedIn post
router.delete("/:id", linkedinController.deletePost);

export default router;

