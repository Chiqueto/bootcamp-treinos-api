import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";

import type { Prisma } from "../generated/prisma/client.js";
import { auth } from "./auth.js";
import { prisma } from "./db.js";

export class AdminError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 404 | 409 = 400) { super(code); }
}

export async function assertAdminUser(db: Pick<Prisma.TransactionClient, "user">, adminUserId: string) {
  const user = await db.user.findUnique({ where: { id: adminUserId }, select: { systemRole: true } });
  if (user?.systemRole !== "ADMIN") throw new AdminError("ADMIN_REQUIRED", 403);
}

export async function requireAdmin(request: FastifyRequest) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) throw new AdminError("UNAUTHORIZED", 401);
  // Role is not a Better Auth editable field. Resolve it from the persisted session user,
  // so admin:revoke takes effect without waiting for a client/session refresh.
  await assertAdminUser(prisma, session.user.id);
  return session.user.id;
}
