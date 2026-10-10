import z from "zod";

import { prisma } from "../lib/db.js";

try {
  const [operation, argument, ...extra] = process.argv.slice(2);
  if (
    !["grant", "revoke"].includes(operation ?? "") ||
    extra.length ||
    !argument?.startsWith("--email=")
  ) {
    throw new Error(
      "Usage: npm run admin:grant -- --email=user@example.com (or admin:revoke)",
    );
  }
  const email = z.email().parse(argument.slice("--email=".length).trim());
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) throw new Error("User does not exist. No user was created.");
  const systemRole = operation === "grant" ? "ADMIN" : "USER";
  await prisma.user.update({ where: { id: user.id }, data: { systemRole } });
  console.log(
    `Role set to ${systemRole} for ${email}. Account type and subscription unchanged.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operation failed");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
