import { createHmac, timingSafeEqual } from "node:crypto";
import { parseEntitlements, type Entitlements } from "./entitlements.ts";

export const ENTITLEMENT_TOKEN_TTL_HOURS = 72;

type TokenBody = { businessId: string; entitlements: Entitlements; expiresAt: string };

function signature(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function assertSecret(secret: string) {
  if (secret.length < 32) throw new RangeError("ENTITLEMENT_SIGNING_SECRET must be at least 32 characters.");
}

export function signEntitlements(entitlements: Entitlements, businessId: string, secret: string, now = new Date()) {
  assertSecret(secret);
  const expiresAt = new Date(now.getTime() + ENTITLEMENT_TOKEN_TTL_HOURS * 3600_000).toISOString();
  const body = Buffer.from(JSON.stringify({ businessId, entitlements, expiresAt } satisfies TokenBody)).toString("base64url");
  return { token: `${body}.${signature(body, secret)}`, expiresAt };
}

export function verifyEntitlements(token: string, secret: string, now = new Date()): { businessId: string; entitlements: Entitlements } | null {
  const [body, provided] = token.split(".");
  if (!body || !provided) return null;
  const expected = Buffer.from(signature(body, secret));
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenBody;
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) return null;
    return { businessId: parsed.businessId, entitlements: parseEntitlements(parsed.entitlements) };
  } catch {
    return null;
  }
}
