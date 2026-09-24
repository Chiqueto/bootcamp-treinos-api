import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  authCookieConfig,
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
});
