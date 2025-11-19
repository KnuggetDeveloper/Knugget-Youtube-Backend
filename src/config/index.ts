import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  API_BASE_URL: z
    .string()
    .url()
    .default("https://knugget-youtube-backend.onrender.com/api"),

  // Database
  DATABASE_URL: z.string().min(1),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4-turbo-preview"),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default("4000"),

  // DODOpayment
  DODO_PAYMENTS_API_KEY: z.string().min(1),
  DODO_BASE_URL: z.string().url().default("https://live.dodopayments.com"),
  DODO_WEBHOOK_SECRET: z.string().min(1).optional(),
  DODO_PAYMENTS_ENVIRONMENT: z.string().default("live_mode"),
  PRODUCT_ID_LITE: z.string().min(1), // Knugget Lite plan product ID
  PRODUCT_ID_PRO: z.string().min(1), // Knugget Pro plan product ID
  FRONTEND_URL: z
    .string()
    .url()
    .default("https://knugget-youtube-client.vercel.app"),

  // Email (Optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().optional(),
  FROM_NAME: z.string().optional(),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .default(
      "https://www.getknugget.com,https://getknugget.com,https://knugget-youtube-client.vercel.app,chrome-extension://,https://knugget-youtube-backend.onrender.com"
    ),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  LOG_FILE: z.string().default("logs/app.log"),

  // Video Limits per Plan (NO CREDITS SYSTEM)
  FREE_PLAN_MONTHLY_VIDEOS: z.string().transform(Number).default("5"),
  LITE_PLAN_MONTHLY_VIDEOS: z.string().transform(Number).default("100"),
  PRO_PLAN_MONTHLY_VIDEOS: z.string().transform(Number).default("300"),

  // Token Limits per Plan
  FREE_INPUT_TOKENS: z.string().transform(Number).default("150000"), // 150K input tokens
  FREE_OUTPUT_TOKENS: z.string().transform(Number).default("10000"), // 10K output tokens

  LITE_INPUT_TOKENS: z.string().transform(Number).default("3000000"), // 3M input tokens
  LITE_OUTPUT_TOKENS: z.string().transform(Number).default("200000"), // 200K output tokens

  PRO_INPUT_TOKENS: z.string().transform(Number).default("9000000"), // 9M input tokens
  PRO_OUTPUT_TOKENS: z.string().transform(Number).default("600000"), // 600K output tokens

  // Feature Flags (for future re-enablement)
  ENABLE_LINKEDIN: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  ENABLE_WEBSITE: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = {
  server: {
    nodeEnv: parsed.data.NODE_ENV,
    apiBaseUrl: parsed.data.API_BASE_URL,
  },
  database: {
    url: parsed.data.DATABASE_URL,
  },
  firebase: {
    projectId: parsed.data.FIREBASE_PROJECT_ID,
    privateKey: parsed.data.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    clientEmail: parsed.data.FIREBASE_CLIENT_EMAIL,
  },
  openai: {
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.OPENAI_MODEL,
    maxTokens: parsed.data.OPENAI_MAX_TOKENS,
  },
  payment: {
    dodoApiKey: parsed.data.DODO_PAYMENTS_API_KEY,
    dodoBaseUrl: parsed.data.DODO_BASE_URL,
    webhookSecret: parsed.data.DODO_WEBHOOK_SECRET,
    environment: parsed.data.DODO_PAYMENTS_ENVIRONMENT,
    productIdLite: parsed.data.PRODUCT_ID_LITE,
    productIdPro: parsed.data.PRODUCT_ID_PRO,
    frontendUrl: parsed.data.FRONTEND_URL,
  },
  email: {
    host: parsed.data.SMTP_HOST,
    port: parsed.data.SMTP_PORT,
    user: parsed.data.SMTP_USER,
    pass: parsed.data.SMTP_PASS,
    fromEmail: parsed.data.FROM_EMAIL,
    fromName: parsed.data.FROM_NAME,
  },
  cors: {
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",").map((origin) =>
      origin.trim()
    ),
  },
  logging: {
    level: parsed.data.LOG_LEVEL,
    file: parsed.data.LOG_FILE,
  },
  videoLimits: {
    free: parsed.data.FREE_PLAN_MONTHLY_VIDEOS,
    lite: parsed.data.LITE_PLAN_MONTHLY_VIDEOS,
    pro: parsed.data.PRO_PLAN_MONTHLY_VIDEOS,
  },
  tokens: {
    free: {
      input: parsed.data.FREE_INPUT_TOKENS,
      output: parsed.data.FREE_OUTPUT_TOKENS,
    },
    lite: {
      input: parsed.data.LITE_INPUT_TOKENS,
      output: parsed.data.LITE_OUTPUT_TOKENS,
    },
    pro: {
      input: parsed.data.PRO_INPUT_TOKENS,
      output: parsed.data.PRO_OUTPUT_TOKENS,
    },
  },
  features: {
    linkedin: parsed.data.ENABLE_LINKEDIN,
    website: parsed.data.ENABLE_WEBSITE,
  },
};

export default config;
