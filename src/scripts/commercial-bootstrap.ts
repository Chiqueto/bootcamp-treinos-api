import { readFile } from "node:fs/promises";

import { prisma } from "../lib/db.js";

try {
  // Repository-owned SQL, never constructed from external input. One atomic insert-only statement.
  const sql = await readFile(
    new URL("../../prisma/commercial-bootstrap.sql", import.meta.url),
    "utf8",
  );
  await prisma.$executeRawUnsafe(sql);
  console.log(
    "Commercial defaults inserted where absent. Existing plans/entitlements preserved.",
  );
} finally {
  await prisma.$disconnect();
}
