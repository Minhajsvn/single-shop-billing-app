// Founding 50 on the public site: the offer text and whether a seat is still free. Safe to import anywhere.

export const FOUNDING_OFFER_TEXT =
  "Founding 50: the first 50 shops to subscribe get Pro features for 12 months at the Starter price.";

/** How long a page may show a stale answer (seconds). */
export const FOUNDING_OFFER_REVALIDATE = 3600;

type Env = { url: string | undefined; key: string | undefined };

const publicEnv = (): Env => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

/**
 * Asks founding_offer_open() with the public key and no cookies, so a static page stays static (revalidated hourly).
 * True only for a 2xx answer that is exactly `true`; anything else, an error or missing settings hide the offer.
 */
export async function foundingOfferOpen(fetchImpl: typeof fetch = fetch, env: Env = publicEnv()): Promise<boolean> {
  if (!env.url || !env.key) return false;
  try {
    const response = await fetchImpl(`${env.url}/rest/v1/rpc/founding_offer_open`, {
      method: "POST",
      headers: { apikey: env.key, authorization: `Bearer ${env.key}`, "content-type": "application/json" },
      body: "{}",
      next: { revalidate: FOUNDING_OFFER_REVALIDATE },
    } as RequestInit);
    if (!response.ok) return false;
    return (await response.text()).trim() === "true";
  } catch {
    return false;
  }
}
