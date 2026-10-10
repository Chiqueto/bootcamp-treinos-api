import { describe, expect, it } from "vitest";
import {
  assertSignupPlan,
  getEntitlementLimit,
  hasEntitlement,
  subscriptionGrantsAccess,
} from "../../src/domain/commercial.js";
import type { Plan, Subscription } from "../../src/generated/prisma/client.js";
import {
  CompleteSignupBodySchema,
  PublicPlansQuerySchema,
  SignupIntentBodySchema,
} from "../../src/schemas/commercial.js";

const now = new Date("2026-10-07T12:00:00Z");
const future = new Date("2026-10-08T12:00:00Z");
const past = new Date("2026-10-06T12:00:00Z");
const plan = {
  code: "COACH",
  audience: "COACH",
  isPublic: true,
  isActive: true,
  monthlyPriceInCents: 3990,
} as Plan;
const subscription = {
  status: "ACTIVE",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  trialStartedAt: null,
  trialEndsAt: null,
} as Subscription;

describe("Commercial policy", () => {
  it.each(["PENDING", "PAST_DUE", "CANCELED", "EXPIRED"] as const)(
    "%s does not grant access",
    (status) => {
      expect(subscriptionGrantsAccess({ ...subscription, status }, now)).toBe(
        false,
      );
    },
  );
  it("ACTIVE grants access within its period", () => {
    expect(subscriptionGrantsAccess(subscription, now)).toBe(true);
    expect(
      subscriptionGrantsAccess(
        { ...subscription, currentPeriodEnd: past },
        now,
      ),
    ).toBe(false);
    expect(
      subscriptionGrantsAccess(
        { ...subscription, currentPeriodStart: future },
        now,
      ),
    ).toBe(false);
  });
  it.each([past, now, null])(
    "expired or missing trial end does not grant access (%s)",
    (trialEndsAt) => {
      expect(
        subscriptionGrantsAccess(
          { ...subscription, status: "TRIALING", trialEndsAt },
          now,
        ),
      ).toBe(false);
    },
  );
  it("future trial grants access without writing status", () => {
    expect(
      subscriptionGrantsAccess(
        { ...subscription, status: "TRIALING", trialEndsAt: future },
        now,
      ),
    ).toBe(true);
  });
  it.each([
    { isPublic: false },
    { isActive: false },
    { audience: "INTERNAL" },
    { audience: "ATHLETE" },
  ])("rejects invalid coach plans %s", (change) => {
    expect(() =>
      assertSignupPlan({ ...plan, ...change } as Plan, "COACH"),
    ).toThrow("INVALID_SIGNUP_PLAN");
  });
  it("athlete requires the free athlete plan", () => {
    expect(() => assertSignupPlan(plan, "ATHLETE")).toThrow();
    const free = {
      ...plan,
      audience: "ATHLETE",
      code: "ATHLETE_FREE",
      monthlyPriceInCents: 0,
    } as Plan;
    expect(() => assertSignupPlan(free, "ATHLETE")).not.toThrow();
    expect(() => assertSignupPlan(free, "COACH")).toThrow();
    expect(() =>
      assertSignupPlan({ ...free, monthlyPriceInCents: 1 }, "ATHLETE"),
    ).toThrow();
  });
  it("helpers distinguish absent, unlimited and limited entitlements", () => {
    const context = {
      entitlements: [
        { key: "MANAGE_ATHLETES" as const, limitValue: 5 },
        { key: "COACH_DASHBOARD" as const, limitValue: null },
      ],
    };
    expect(hasEntitlement(context, "AI_CHAT")).toBe(false);
    expect(getEntitlementLimit(context, "AI_CHAT")).toBeUndefined();
    expect(hasEntitlement(context, "COACH_DASHBOARD")).toBe(true);
    expect(getEntitlementLimit(context, "COACH_DASHBOARD")).toBeNull();
    expect(getEntitlementLimit(context, "MANAGE_ATHLETES")).toBe(5);
  });
  it.each([
    "systemRole",
    "subscriptionStatus",
    "billingProvider",
    "price",
    "entitlements",
    "userId",
  ])("rejects privileged client field %s", (field) => {
    expect(
      SignupIntentBodySchema.safeParse({
        accountType: "COACH",
        planCode: "COACH",
        [field]: "ADMIN",
      }).success,
    ).toBe(false);
  });
  it("rejects internal audience and client identity on completion", () => {
    expect(
      PublicPlansQuerySchema.safeParse({ audience: "INTERNAL" }).success,
    ).toBe(false);
    expect(
      SignupIntentBodySchema.safeParse({
        accountType: "INTERNAL",
        planCode: "INTERNAL",
      }).success,
    ).toBe(false);
    expect(
      CompleteSignupBodySchema.safeParse({
        token: "a".repeat(43),
        userId: "other",
      }).success,
    ).toBe(false);
  });
});
