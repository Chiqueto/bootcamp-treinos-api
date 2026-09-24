import fs from "node:fs";
import path from "node:path";

import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";

import {
  authBaseUrl,
  authCookieConfig,
  resolveAuthBaseUrl,
  resolveAuthCookieConfig,
  resolveTrustedOrigins,
  trustedOrigins,
} from "../../src/lib/auth.js";
import { env } from "../../src/lib/env.js";

describe("Task 0.5 — Configuração de Autenticação, Cookies e Origens", () => {
  describe("resolveAuthCookieConfig", () => {
    it("Cenário 1 — Sem AUTH_COOKIE_DOMAIN: desabilita cross-subdomain cookies (host-only)", () => {
      const configUndefined = resolveAuthCookieConfig(undefined);
      expect(configUndefined).toEqual({
        enabled: false,
      });

      const configEmpty = resolveAuthCookieConfig("");
      expect(configEmpty).toEqual({
        enabled: false,
      });

      const configWhitespace = resolveAuthCookieConfig("   ");
      expect(configWhitespace).toEqual({
        enabled: false,
      });
    });

    it("Cenário 2 — Com AUTH_COOKIE_DOMAIN válido: habilita cross-subdomain cookies com o domínio informado", () => {
      const config1 = resolveAuthCookieConfig("fitai.com.br");
      expect(config1).toEqual({
        enabled: true,
        domain: "fitai.com.br",
      });

      const configWithLeadingDot = resolveAuthCookieConfig(".fitai.com.br");
      expect(configWithLeadingDot).toEqual({
        enabled: true,
        domain: ".fitai.com.br",
      });

      const configWithTrim = resolveAuthCookieConfig("  fitai.com.br  ");
      expect(configWithTrim).toEqual({
        enabled: true,
        domain: "fitai.com.br",
      });
    });

    it("Cenário 3 — Runtime normal sem variável nova continua funcionando com cookies host-only", () => {
      // Se AUTH_COOKIE_DOMAIN não estiver definido no ambiente padrão local,
      // authCookieConfig exportado no runtime da aplicação deve estar desabilitado
      expect(authCookieConfig).toBeDefined();
      if (!env.AUTH_COOKIE_DOMAIN) {
        expect(authCookieConfig.enabled).toBe(false);
        expect(authCookieConfig.domain).toBeUndefined();
      } else {
        expect(authCookieConfig.enabled).toBe(true);
        expect(authCookieConfig.domain).toBe(env.AUTH_COOKIE_DOMAIN.trim());
      }
    });

    it("Cenário 4 — Nenhuma configuração ativa ou código-fonte contém .onrender.com", () => {
      const authFilePath = path.resolve(__dirname, "../../src/lib/auth.ts");
      const authFileContent = fs.readFileSync(authFilePath, "utf-8");

      expect(authFileContent).not.toContain(".onrender.com");
      expect(authFileContent).not.toContain("onrender");

      const indexFilePath = path.resolve(__dirname, "../../src/index.ts");
      const indexFileContent = fs.readFileSync(indexFilePath, "utf-8");

      expect(indexFileContent).not.toContain(".onrender.com");
      expect(indexFileContent).not.toContain("onrender");
    });

    it("Cenário 5 — Não existe tentativa de configurar .vercel.app como cookie domain", () => {
      const configuredDomain = env.AUTH_COOKIE_DOMAIN?.trim().toLowerCase();
      if (configuredDomain) {
        expect(configuredDomain.endsWith("vercel.app")).toBe(false);
      }

      // Garante que o .env.example também não sugira .vercel.app
      const envExamplePath = path.resolve(__dirname, "../../.env.example");
      const envExampleContent = fs.readFileSync(envExamplePath, "utf-8");
      expect(envExampleContent).not.toMatch(/AUTH_COOKIE_DOMAIN=.*vercel\.app/i);
    });
  });

  describe("resolveTrustedOrigins", () => {
    it("normaliza a URL base removendo trailing slash", () => {
      const origins = resolveTrustedOrigins("http://localhost:3000/");
      expect(origins).toEqual(["http://localhost:3000"]);
    });

    it("adiciona origens extras passadas como array", () => {
      const origins = resolveTrustedOrigins("http://localhost:3000", [
        "https://app.fitai.com.br",
        "https://fitai-preview.vercel.app/",
      ]);

      expect(origins).toEqual([
        "http://localhost:3000",
        "https://app.fitai.com.br",
        "https://fitai-preview.vercel.app",
      ]);
    });

    it("adiciona origens extras passadas como string separada por vírgula", () => {
      const origins = resolveTrustedOrigins(
        "http://localhost:3000",
        "https://preview1.vercel.app, https://preview2.vercel.app/"
      );

      expect(origins).toEqual([
        "http://localhost:3000",
        "https://preview1.vercel.app",
        "https://preview2.vercel.app",
      ]);
    });

    it("ignora entradas vazias e desduplica origens", () => {
      const origins = resolveTrustedOrigins(
        "http://localhost:3000",
        "http://localhost:3000, ,   , https://app.fitai.com.br"
      );

      expect(origins).toEqual([
        "http://localhost:3000",
        "https://app.fitai.com.br",
      ]);
    });

    it("a exportação trustedOrigins do runtime inclui a WEB_APP_BASE_URL", () => {
      const primaryOrigin = new URL(env.WEB_APP_BASE_URL).origin;
      expect(trustedOrigins).toContain(primaryOrigin);
    });
  });

  describe("Gateway first-party /backend e separação de URLs", () => {
    describe("resolveAuthBaseUrl", () => {
      it("utiliza AUTH_BASE_URL explícita quando definida (cenário de homologação)", () => {
        const url = resolveAuthBaseUrl(
          "https://fitai-api.vercel.app",
          "https://fitai-web.vercel.app/backend/api/auth"
        );
        expect(url).toBe("https://fitai-web.vercel.app/backend/api/auth");
      });

      it("remove trailing slash de AUTH_BASE_URL", () => {
        const url = resolveAuthBaseUrl(
          "https://fitai-api.vercel.app",
          "https://fitai-web.vercel.app/backend/api/auth/"
        );
        expect(url).toBe("https://fitai-web.vercel.app/backend/api/auth");
      });

      it("faz fallback para ${API_BASE_URL}/api/auth quando AUTH_BASE_URL não está definida (cenário local)", () => {
        const url = resolveAuthBaseUrl("http://localhost:8080", undefined);
        expect(url).toBe("http://localhost:8080/api/auth");
      });

      it("não duplica /api/auth se API_BASE_URL já contiver o sufixo", () => {
        const url = resolveAuthBaseUrl("http://localhost:8080/api/auth", "");
        expect(url).toBe("http://localhost:8080/api/auth");
      });
    });

    describe("Google OAuth Redirect URI via Better Auth", () => {
      it("gera redirect_uri apontando para o gateway /backend e não para a URL física da API", async () => {
        const testAuth = betterAuth({
          baseURL: "https://fitai-web.vercel.app/backend/api/auth",
          socialProviders: {
            google: {
              clientId: "test-client-id",
              clientSecret: "test-client-secret",
            },
          },
        });

        const res = await testAuth.api.signInSocial({
          body: {
            provider: "google",
            callbackURL: "https://fitai-web.vercel.app/",
          },
        });

        expect(res.url).toBeDefined();
        if (!res.url) {
          throw new Error("Expected res.url to be defined");
        }
        const googleAuthUrl = new URL(res.url);
        const redirectUri = googleAuthUrl.searchParams.get("redirect_uri");

        expect(redirectUri).toBe(
          "https://fitai-web.vercel.app/backend/api/auth/callback/google"
        );
        expect(redirectUri).toContain("/backend");
        expect(redirectUri).not.toContain("fitai-api.vercel.app");
      });
    });

    describe("Segurança do manipulador Fastify de autenticação", () => {
      it("não utiliza inferência insegura de Host (request.headers.host)", () => {
        const indexFilePath = path.resolve(__dirname, "../../src/index.ts");
        const indexFileContent = fs.readFileSync(indexFilePath, "utf-8");

        expect(indexFileContent).not.toContain("request.headers.host");
        expect(indexFileContent).toContain("authBaseUrl");
      });

      it("o authBaseUrl exportado no runtime está devidamente configurado", () => {
        expect(authBaseUrl).toBeDefined();
        expect(authBaseUrl.startsWith("http")).toBe(true);
      });
    });

    describe("Frontend rewrites e resolução de URLs", () => {
      it("configuração de rewrite do frontend mapeia /backend/:path* para BACKEND_ORIGIN/:path*", () => {
        const frontendNextConfigPath = path.resolve(
          __dirname,
          "../../../bootcamp-treinos-frontend/next.config.ts"
        );

        if (fs.existsSync(frontendNextConfigPath)) {
          const content = fs.readFileSync(frontendNextConfigPath, "utf-8");
          expect(content).toContain('source: "/backend/:path*"');
          expect(content).toContain("destination: `${backendOrigin}/:path*`");
          expect(content).toContain("process.env.BACKEND_ORIGIN");
          expect(content).not.toContain("process.env.NEXT_PUBLIC_BACKEND_ORIGIN");
        }

        // Valida o contrato de resolução do rewrite do Next.js
        const resolveRewrite = (
          backendOrigin: string | undefined,
          pathSegment: string
        ) => {
          const origin = (backendOrigin || "http://localhost:8080").replace(
            /\/+$/,
            ""
          );
          const cleanPath = pathSegment.startsWith("/")
            ? pathSegment.slice(1)
            : pathSegment;
          return `${origin}/${cleanPath}`;
        };

        // 1. rewrite /backend/ai aponta para /ai
        expect(resolveRewrite("https://fitai-api.vercel.app", "ai")).toBe(
          "https://fitai-api.vercel.app/ai"
        );
        expect(resolveRewrite(undefined, "ai")).toBe("http://localhost:8080/ai");

        // 2. rewrite /backend/api/auth/... aponta para /api/auth/...
        expect(
          resolveRewrite(
            "https://fitai-api.vercel.app",
            "api/auth/callback/google"
          )
        ).toBe("https://fitai-api.vercel.app/api/auth/callback/google");
        expect(
          resolveRewrite("https://fitai-api.vercel.app", "api/auth/get-session")
        ).toBe("https://fitai-api.vercel.app/api/auth/get-session");
      });

      it("auth-client do frontend resolve baseURL contendo /api/auth", () => {
        const frontendAuthClientPath = path.resolve(
          __dirname,
          "../../../bootcamp-treinos-frontend/app/_lib/auth-client.ts"
        );

        if (fs.existsSync(frontendAuthClientPath)) {
          const content = fs.readFileSync(frontendAuthClientPath, "utf-8");
          expect(content).toContain("resolveAuthClientBaseUrl");
          expect(content).toContain("baseURL: resolveAuthClientBaseUrl");
        }

        const resolveAuthClientBaseUrl = (rawApiUrl?: string): string => {
          const apiUrl = (rawApiUrl || "http://localhost:8080")
            .trim()
            .replace(/\/+$/, "");
          return apiUrl.endsWith("/api/auth") ? apiUrl : `${apiUrl}/api/auth`;
        };

        // Em homologação com NEXT_PUBLIC_API_URL=https://fitai-web.vercel.app/backend
        expect(
          resolveAuthClientBaseUrl("https://fitai-web.vercel.app/backend")
        ).toBe("https://fitai-web.vercel.app/backend/api/auth");

        // Em desenvolvimento local com NEXT_PUBLIC_API_URL=http://localhost:8080
        expect(resolveAuthClientBaseUrl("http://localhost:8080")).toBe(
          "http://localhost:8080/api/auth"
        );

        // Se já contiver /api/auth
        expect(
          resolveAuthClientBaseUrl(
            "https://fitai-web.vercel.app/backend/api/auth"
          )
        ).toBe("https://fitai-web.vercel.app/backend/api/auth");
      });
    });
  });
});

