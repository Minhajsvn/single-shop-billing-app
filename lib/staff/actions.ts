// Input checks and plain messages for the owner's staff routes (spec 2A §4.4, §6). Pure: used by routes and tests.

type Fail = { ok: false; code: string };
const fail = (code: string): Fail => ({ ok: false, code });
const record = (body: unknown) => (body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null);

export type StaffRole = "cashier" | "manager";
const staffRole = (value: unknown): StaffRole | null => (value === "cashier" || value === "manager" ? value : null);

function cleanEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || /\s/.test(email) || email.indexOf(".", at) < at + 2 || email.endsWith(".") || email.length > 254) return null;
  return email;
}

export function parseInvite(body: unknown): { ok: true; email: string; displayName: string; role: StaffRole } | Fail {
  const input = record(body);
  const email = cleanEmail(input?.email);
  if (!email) return fail("email_invalid");
  const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
  if (displayName.length < 1 || displayName.length > 60) return fail("name_invalid");
  const role = staffRole(input?.role);
  if (!role) return fail("role_not_allowed");
  return { ok: true, email, displayName, role };
}

export function parseMemberUpdate(body: unknown): { ok: true; change: { role: StaffRole } | { status: "active" | "disabled" } } | Fail {
  const input = record(body);
  if (!input) return fail("role_not_allowed");
  const hasRole = input.role !== undefined;
  if (hasRole === (input.status !== undefined)) return fail("role_not_allowed");
  if (hasRole) {
    const role = staffRole(input.role);
    return role ? { ok: true, change: { role } } : fail("role_not_allowed");
  }
  return input.status === "active" || input.status === "disabled" ? { ok: true, change: { status: input.status } } : fail("role_not_allowed");
}

/** Only the device-made hash and salt are accepted; a raw PIN never reaches the server. */
export function parsePinSet(body: unknown): { ok: true; pinHash: string; pinSalt: string } | Fail {
  const input = record(body);
  const pinHash = typeof input?.pinHash === "string" ? input.pinHash : "";
  const pinSalt = typeof input?.pinSalt === "string" ? input.pinSalt : "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(pinHash) || !/^[A-Za-z0-9+/]{22}==$/.test(pinSalt)) return fail("invalid_pin_hash");
  return { ok: true, pinHash, pinSalt };
}

export function parseLockSettings(body: unknown): { ok: true; pinLockEnabled: boolean; idleLockMinutes: number; managerDiscountPct: number } | Fail {
  const input = record(body);
  const { pinLockEnabled, idleLockMinutes, managerDiscountPct } = input ?? {};
  if (typeof pinLockEnabled !== "boolean") return fail("invalid_settings");
  if (typeof idleLockMinutes !== "number" || !Number.isInteger(idleLockMinutes) || idleLockMinutes < 1 || idleLockMinutes > 60) return fail("invalid_settings");
  if (typeof managerDiscountPct !== "number" || !Number.isInteger(managerDiscountPct) || managerDiscountPct < 0 || managerDiscountPct > 100) return fail("invalid_settings");
  return { ok: true, pinLockEnabled, idleLockMinutes, managerDiscountPct };
}

const MESSAGES: Record<string, string> = {
  pin_not_set: "Set your own PIN first, then turn on the PIN lock.",
  member_disabled: "This person is disabled. Turn them back on before setting a PIN.",
  owner_protected: "The shop owner cannot be changed or disabled.",
  plan_limit_reached: "Your plan has no room for another user. Upgrade to add more staff.",
  feature_not_in_plan: "The PIN lock is part of the Pro plan.",
  not_owner: "Only the shop owner can manage staff.",
  already_member: "This person is already on your staff list.",
  member_of_other_shop: "This person already works for another shop on billo.",
  member_not_found: "That staff member could not be found.",
  email_invalid: "Enter a valid email address.",
  name_invalid: "Enter a name of up to 60 characters.",
  role_not_allowed: "Choose cashier or manager.",
  invalid_pin_hash: "The PIN could not be saved. Try again.",
  invalid_settings: "Check the lock settings: 1 to 60 minutes and 0 to 100 percent.",
  invite_failed: "The invitation email could not be sent. Try again in a minute.",
};

export function staffErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}

export function isKnownStaffCode(code: string): boolean {
  return code in MESSAGES;
}
