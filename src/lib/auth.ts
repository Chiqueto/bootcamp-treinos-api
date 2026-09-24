import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI } from "better-auth/plugins";

import { prisma } from "./db.js";
import { env } from "./env.js";

export interface AuthCookieConfig {
  enabled: boolean;
  domain?: string;
}

export function resolveAuthCookieConfig(
  authCookieDomain?: string
): AuthCookieConfig {
  const domain = authCookieDomain?.trim();
  if (!domain) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    domain,
  };
}

export function resolveTrustedOrigins(
  webAppBaseUrl: string,
  additionalOrigins?: string | string[]
): string[] {
  const origins = new Set<string>();

  const addOrigin = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      origins.add(trimmed);
    }
  };

  addOrigin(webAppBaseUrl);

  if (additionalOrigins) {
    const list = Array.isArray(additionalOrigins)
      ? additionalOrigins
      : additionalOrigins.split(",");
    for (const item of list) {
      addOrigin(item);
    }
  }

  return Array.from(origins);
}

export const trustedOrigins = resolveTrustedOrigins(
  env.WEB_APP_BASE_URL,
  env.ADDITIONAL_TRUSTED_ORIGINS
);

export const authCookieConfig = resolveAuthCookieConfig(env.AUTH_COOKIE_DOMAIN);

export function resolveAuthBaseUrl(
  apiBaseUrl: string,
  authBaseUrl?: string
): string {
  if (authBaseUrl?.trim()) {
    return authBaseUrl.trim().replace(/\/+$/, "");
  }
  const cleanApi = apiBaseUrl.trim().replace(/\/+$/, "");
  return cleanApi.endsWith("/api/auth") ? cleanApi : `${cleanApi}/api/auth`;
}

export const authBaseUrl = resolveAuthBaseUrl(
  env.API_BASE_URL,
  env.AUTH_BASE_URL
);

export const auth = betterAuth({
  baseURL: authBaseUrl,
  trustedOrigins,

  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [openAPI()],
  advanced: {
    crossSubDomainCookies: authCookieConfig,
  },
});
