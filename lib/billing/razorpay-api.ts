// SERVER ONLY. A thin fetch wrapper over the Razorpay REST API (no SDK, so no dependency).
type Env = Record<string, string | undefined>;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

const BASE_URL = "https://api.razorpay.com/v1";

/** `path` starts with a slash and is relative to /v1, for example "/subscriptions/sub_123". */
export async function razorpayRequest(
  env: Env,
  method: "GET" | "POST",
  path: string,
  body?: object,
  fetchImpl: FetchLike = fetch,
): Promise<{ status: number; json: unknown }> {
  const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const response = await fetchImpl(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Basic ${credentials}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Razorpay errors are JSON ({ error: { description } }); anything unreadable is treated as an empty answer.
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** The error description of a Razorpay error answer, or "". */
export function razorpayErrorDescription(json: unknown): string {
  const description = (json as { error?: { description?: unknown } } | null)?.error?.description;
  return typeof description === "string" ? description : "";
}

/** A subscription id Razorpay does not know: 404, or 400 with a "does not exist" description. */
export function isMissing(result: { status: number; json: unknown }): boolean {
  return result.status === 404 || (result.status === 400 && /does not exist/i.test(razorpayErrorDescription(result.json)));
}
