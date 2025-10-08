import admin from "firebase-admin";
import { config } from "./index";
import { logger } from "./logger";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        privateKey: config.firebase.privateKey,
        clientEmail: config.firebase.clientEmail,
      }),
      projectId: config.firebase.projectId,
    });

    logger.info("Firebase Admin SDK initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize Firebase Admin SDK", { error });
    throw error;
  }
}

export const firebaseAuth = admin.auth();
export const firebaseAdmin = admin;

export default admin;
