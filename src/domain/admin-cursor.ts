import z from "zod";

import { AdminError } from "../lib/require-admin.js";

const schema = z.object({ v: z.literal(1), kind: z.string(), date: z.iso.datetime(), id: z.string().min(1).max(200) });
export function adminCursor(kind: string, row: { id: string; createdAt: Date }) {
  return Buffer.from(JSON.stringify({ v: 1, kind, date: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}
export function adminBoundary(kind: string, cursor?: string) {
  if (!cursor) return {};
  try {
    const value = schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (value.kind !== kind) throw new Error();
    const date = new Date(value.date);
    return { OR: [{ createdAt: { lt: date } }, { createdAt: date, id: { lt: value.id } }] };
  } catch { throw new AdminError("INVALID_CURSOR"); }
}
export function adminPage<T extends { id: string; createdAt: Date }>(kind: string, rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, hasMore, nextCursor: hasMore ? adminCursor(kind, items[items.length - 1]) : null };
}
