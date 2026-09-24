import { describe, expect, it } from "vitest";

import { resolveDatabaseUrl } from "../src/lib/db.js";

describe("Test Database Guard (resolveDatabaseUrl)", () => {
  const prodDbUrl = "postgresql://user:pass@host:5432/production_db";
  const testDbUrl = "postgresql://user:pass@host:5432/test_db";

  it("should throw an immediate clear error if TEST_DATABASE_URL is missing in test mode", () => {
    expect(() =>
      resolveDatabaseUrl({
        nodeEnv: "test",
        databaseUrl: prodDbUrl,
        testDatabaseUrl: undefined,
      }),
    ).toThrowError(/TEST_DATABASE_URL está ausente/);
  });

  it("should throw an immediate clear error if TEST_DATABASE_URL is empty in test mode", () => {
    expect(() =>
      resolveDatabaseUrl({
        nodeEnv: "test",
        databaseUrl: prodDbUrl,
        testDatabaseUrl: "   ",
      }),
    ).toThrowError(/TEST_DATABASE_URL está ausente/);
  });

  it("should throw an error preventing execution if TEST_DATABASE_URL is identical to DATABASE_URL", () => {
    expect(() =>
      resolveDatabaseUrl({
        nodeEnv: "test",
        databaseUrl: prodDbUrl,
        testDatabaseUrl: prodDbUrl,
      }),
    ).toThrowError(/não pode ser idêntica a DATABASE_URL/);
  });

  it("should return TEST_DATABASE_URL when running in test mode with a distinct test database", () => {
    const resolved = resolveDatabaseUrl({
      nodeEnv: "test",
      databaseUrl: prodDbUrl,
      testDatabaseUrl: testDbUrl,
    });

    expect(resolved).toBe(testDbUrl);
  });

  it("should preserve normal DATABASE_URL in development mode", () => {
    const resolved = resolveDatabaseUrl({
      nodeEnv: "development",
      databaseUrl: prodDbUrl,
      testDatabaseUrl: undefined,
    });

    expect(resolved).toBe(prodDbUrl);
  });

  it("should preserve normal DATABASE_URL in production mode", () => {
    const resolved = resolveDatabaseUrl({
      nodeEnv: "production",
      databaseUrl: prodDbUrl,
      testDatabaseUrl: undefined,
    });

    expect(resolved).toBe(prodDbUrl);
  });
});
