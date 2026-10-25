import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { confirmParams } from "@/lib/auth/signup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Email links (sign-up confirmation, password reset) land here. Token-hash verification works on any
// device, unlike a code exchange that needs the browser that asked for the email.
export async function GET(request: NextRequest) {
  const params = confirmParams(request.nextUrl);
  let destination = "/login?confirm=failed";

  if (params) {
    try {
      const supabase = await createServerSupabaseClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
      if (!error) destination = params.next;
    } catch {
      // Unconfigured or unreachable auth: treat the link as unusable.
    }
  }

  redirect(destination);
}
