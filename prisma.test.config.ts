import "dotenv/config";
import { defineConfig } from "prisma/config";

const testUrl = process.env.TEST_DATABASE_URL;
const primaryUrl = process.env.DATABASE_URL;
if (!testUrl || !primaryUrl)
  throw new Error("Both database URLs are required.");
const test = new URL(testUrl);
const primary = new URL(primaryUrl);
if (
  test.hostname === primary.hostname &&
  test.port === primary.port &&
  test.pathname === primary.pathname
) {
  throw new Error(
    "Refusing migration: test and application database must be distinct.",
  );
}
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: testUrl },
});
