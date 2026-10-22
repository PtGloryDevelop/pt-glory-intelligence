import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Keeps the Supabase session alive across page loads.
 *
 * Pages are server components, which cannot write cookies: a token refreshed while a page rendered was spent
 * without the new one reaching the browser, and the next request signed the person out about an hour after
 * they logged in. Here the refresh happens before the page renders, and the new cookies go both to the page
 * (on the request) and to the browser (on the response).
 *
 * Refresh only. Who may see what is still decided by each page and route, never here.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Refreshes an expired token through setAll; nothing may run between creating the client and this call.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Pages and server actions only. API route handlers can write cookies themselves, and pictures, scripts
  // and styles carry no session to refresh.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)"],
};
