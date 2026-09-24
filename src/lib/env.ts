import "dotenv/config";

import z from "zod";

const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string(),
  API_BASE_URL: z.url().default("http://localhost:8080"),
  AUTH_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string(),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  WEB_APP_BASE_URL: z.url(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  TEST_DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().startsWith("postgresql://").optional()
  ),
  AUTH_COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  ADDITIONAL_TRUSTED_ORIGINS: z.preprocess(
    emptyToUndefined,
    z.string().optional()
  ),
});

export const env = envSchema.parse(process.env);
