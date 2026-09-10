"use server";

import { redirect } from "next/navigation";
import { dbUser } from "@/lib/db/user";

/**
 * Ends the session.
 *
 * A server action for the same reason signing in is one: the session lives in
 * cookies that only a server response can clear. Doing it in the browser would
 * drop the client's copy of the token and leave the cookie the next request
 * still sends.
 *
 * Missing until the pilot, which was a real gap rather than a cosmetic one — on
 * a shared machine there was no way to stop being signed in.
 */
export async function signOut() {
  const supabase = await dbUser();
  await supabase.auth.signOut();
  redirect("/login");
}
