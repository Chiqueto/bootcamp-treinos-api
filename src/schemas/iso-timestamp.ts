import z from "zod";

// Keep strict ISO validation at runtime. OpenAPI's date-time format is enough
// for clients; Orval 8.1 can corrupt nullable unions containing Zod's long regex.
export const IsoTimestamp = z.iso.datetime().meta({ pattern: undefined });
export const OffsetIsoTimestamp = z.iso.datetime({ offset: true }).meta({ pattern: undefined });
