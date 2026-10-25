// SERVER ONLY. Shared plumbing for the admin action routes under app/api/v1/admin/shops/[id].
import { refusalMessage } from "@/lib/admin/actions";

/** Reads a JSON body; anything unreadable becomes null so the parsers refuse it in plain words. */
export async function readBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function refused(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/** Turns an rpc error into a response: our refusal codes as 400 in plain words, anything else as a logged 500. */
export function rpcFailure(action: string, error: { code?: string; message?: string }): Response {
  const { known, message } = refusalMessage(error);
  if (!known) console.error(`admin ${action} failed`, error.code, error.message);
  return Response.json({ error: message }, { status: known ? 400 : 500 });
}
