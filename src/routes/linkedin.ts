// src/routes/linkedin.ts
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

// Save LinkedIn post
router.post(
  "/posts",
  validate(saveLinkedinPostSchema) as any,
  linkedinController.savePost
);

// Get user's LinkedIn posts with pagination and filtering
router.get("/posts", linkedinController.getPosts);

// Get LinkedIn post statistics
router.get("/posts/stats", linkedinController.getStats);

// Get single LinkedIn post by ID
router.get("/posts/:id", linkedinController.getPostById);

// Update LinkedIn post
router.put(
  "/posts/:id",
  validate(updateLinkedinPostSchema) as any,
  linkedinController.updatePost
);

// Delete LinkedIn post
router.delete("/posts/:id", linkedinController.deletePost);

// Bulk delete LinkedIn posts
router.post("/posts/bulk-delete", linkedinController.bulkDeletePosts);

export default router;

