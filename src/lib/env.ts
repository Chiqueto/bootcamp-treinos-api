import "dotenv/config";

import z from "zod";

const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

const isPostgresUrl = (val: string) =>
  val.startsWith("postgresql://") || val.startsWith("postgres://");

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().refine(isPostgresUrl, {
    message: "DATABASE_URL must start with postgresql:// or postgres://",
  }),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  API_BASE_URL: z.url().default("http://localhost:8080"),
  AUTH_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_GENERATIVE_AI_API_KEY: z
    .string()
    .min(1, "GOOGLE_GENERATIVE_AI_API_KEY is required"),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  WEB_APP_BASE_URL: z.url("WEB_APP_BASE_URL must be a valid URL"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  TEST_DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine(isPostgresUrl, {
        message:
          "TEST_DATABASE_URL must start with postgresql:// or postgres://",
      })
      .optional()
  ),
  AUTH_COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  ADDITIONAL_TRUSTED_ORIGINS: z.preprocess(
    emptyToUndefined,
    z.string().optional()
  ),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error(
    "\n❌ [FATAL] Erro nas variáveis de ambiente na inicialização:\n",
    JSON.stringify(envResult.error.format(), null, 2),
    "\n"
  );
  throw new Error(
    `Variáveis de ambiente inválidas ou ausentes: ${JSON.stringify(
      envResult.error.issues.map((i) => ({ path: i.path, message: i.message }))
    )}`
  );
}

export const env = envResult.data;
