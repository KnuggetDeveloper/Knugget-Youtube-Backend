import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  API_BASE_URL: z.string().url().default("http://localhost:3000/api"),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4-turbo-preview"),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default("4000"),

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
      "http://localhost:8000,https://knugget-youtube-client.vercel.app,chrome-extension://,https://knugget-youtube-backend.onrender.com"
    ),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  LOG_FILE: z.string().default("logs/app.log"),

  // Credits
  CREDITS_PER_SUMMARY: z.string().transform(Number).default("1"),
  FREE_PLAN_MONTHLY_CREDITS: z.string().transform(Number).default("10"),
  PREMIUM_PLAN_MONTHLY_CREDITS: z.string().transform(Number).default("1000"),

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
    directUrl: parsed.data.DIRECT_URL,
  },
  supabase: {
    url: parsed.data.SUPABASE_URL,
    anonKey: parsed.data.SUPABASE_ANON_KEY,
    serviceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  },
  jwt: {
    secret: parsed.data.JWT_SECRET,
    expiresIn: parsed.data.JWT_EXPIRES_IN,
    refreshSecret: parsed.data.REFRESH_TOKEN_SECRET,
    refreshExpiresIn: parsed.data.REFRESH_TOKEN_EXPIRES_IN,
  },
  openai: {
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.OPENAI_MODEL,
    maxTokens: parsed.data.OPENAI_MAX_TOKENS,
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
  credits: {
    perSummary: parsed.data.CREDITS_PER_SUMMARY,
    freeMonthly: parsed.data.FREE_PLAN_MONTHLY_CREDITS,
    premiumMonthly: parsed.data.PREMIUM_PLAN_MONTHLY_CREDITS,
  },
  features: {
    linkedin: parsed.data.ENABLE_LINKEDIN,
    website: parsed.data.ENABLE_WEBSITE,
  },
};

export default config;
