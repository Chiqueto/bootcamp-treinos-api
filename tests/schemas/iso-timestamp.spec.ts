import z from "zod";
import { describe, expect, it } from "vitest";
import { IsoTimestamp, OffsetIsoTimestamp } from "../../src/schemas/iso-timestamp.js";

describe("ISO timestamp / OpenAPI compatibility", () => {
  it("keeps strict runtime UTC validation", () => {
    expect(IsoTimestamp.parse("2026-10-09T19:32:00.000Z")).toBe("2026-10-09T19:32:00.000Z");
    for (const invalid of ["2026-02-30T19:32:00Z", "2026-10-09", "not-a-date", "2026-10-09T19:32:00-03:00"])
      expect(IsoTimestamp.safeParse(invalid).success).toBe(false);
  });

  it("allows explicit offsets only on offset inputs", () => {
    expect(OffsetIsoTimestamp.safeParse("2026-10-09T19:32:00-03:00").success).toBe(true);
    expect(OffsetIsoTimestamp.safeParse("2026-10-09T19:32:00").success).toBe(false);
  });

  it("exports date-time without the regex that corrupts Orval nullable unions", () => {
    const schema = z.toJSONSchema(IsoTimestamp);
    expect(schema.format).toBe("date-time");
    expect(schema.pattern).toBeUndefined();
    expect(IsoTimestamp.nullable().parse(null)).toBeNull();
  });
});
