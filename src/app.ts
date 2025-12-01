import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config/index";
import { logger } from "./config/logger";
import { prisma } from "./config/database";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authService } from "./services/auth";
import { summaryService } from "./services/summary";

const app = express();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.openai.com"],
      },
    },
  })
);

// FIXED: Enhanced CORS configuration for extension support
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        // Production domains
        "https://www.getknugget.com",
        "https://getknugget.com",
        "https://knugget-youtube-client.vercel.app",
        "https://knugget-new-client.vercel.app",
        "chrome-extension://",
        "https://knugget-youtube-backend.onrender.com",
        // Development origins
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8000",
      ];

      // Check if origin is in allowed list or is chrome-extension
      if (
        allowedOrigins.some(
          (allowedOrigin) =>
            origin === allowedOrigin ||
            origin.startsWith(allowedOrigin) ||
            (allowedOrigin === "chrome-extension://" &&
              origin.startsWith("chrome-extension://"))
        )
      ) {
        return callback(null, true);
      }

      // Log unauthorized origin attempts
      logger.warn("CORS blocked origin:", { origin });

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400, // 24 hours
  })
);

// Request parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve static files for generated infographics
app.use("/uploads", express.static("uploads"));

// Logging middleware
app.use(
  morgan("combined", {
    stream: {
      write: (message: string) => {
        logger.info(message.trim());
      },
    },
    skip: (req) => {
      // Skip logging for health checks in production
      return (
        config.server.nodeEnv === "production" && req.url === "/api/health"
      );
    },
  })
);

// CRITICAL: Debug middleware to log all routes
app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// API routes - CRITICAL: This must mount all routes including LinkedIn
app.use("/api", routes);

// ADDITIONAL DEBUG: List all registered routes at startup
app._router?.stack?.forEach((middleware: any) => {
  if (middleware.route) {
    console.log(
      `📍 Route: ${Object.keys(middleware.route.methods)
        .join(", ")
        .toUpperCase()} ${middleware.route.path}`
    );
  } else if (middleware.name === "router") {
    middleware.handle?.stack?.forEach((handler: any) => {
      if (handler.route) {
        console.log(
          `📍 Nested Route: ${Object.keys(handler.route.methods)
            .join(", ")
            .toUpperCase()} ${handler.route.path}`
        );
      }
    });
  }
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  try {
    await prisma.$disconnect();
    logger.info("Database connection closed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during graceful shutdown", { error });
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Cleanup tasks (run periodically)
const runCleanupTasks = async () => {
  try {
    logger.info("Running cleanup tasks");
    await authService.cleanupExpiredTokens();
    await summaryService.cleanupOldSummaries();
    logger.info("Cleanup tasks completed");
  } catch (error) {
    logger.error("Cleanup tasks failed", { error });
  }
};

// Run cleanup tasks every 24 hours in production
if (config.server.nodeEnv === "production") {
  setInterval(runCleanupTasks, 24 * 60 * 60 * 1000);
}

// Start server
const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info("Database connected successfully");

    const server = app.listen(3000, () => {
      logger.info(`🚀 Knugget API server running on port 3000`);
      logger.info(`📡 Environment: ${config.server.nodeEnv}`);
      logger.info(`🔗 API Base URL: ${config.server.apiBaseUrl}`);
      logger.info(`🌐 CORS Origins: ${config.cors.allowedOrigins.join(", ")}`);

      // CRITICAL: Log all available routes at startup
      console.log("\n📋 Available API Routes:");
      console.log("├── /api/health");
      console.log("├── /api/auth/*");
      console.log("├── /api/summary/*");
      console.log("├── /api/user/*");
      console.log("├── /api/payment/*");
      // console.log('└── /api/linkedin/*'); // This should appear!
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.syscall !== "listen") {
        throw error;
      }

      const bind = `Port 3000`;

      switch (error.code) {
        case "EACCES":
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case "EADDRINUSE":
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    return server;
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

export default app;
