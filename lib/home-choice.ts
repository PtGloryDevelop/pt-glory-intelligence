/** Which page `/` opens for this browser. A page preference, not a secret: readable by the page that sets it. */
export const HOME_COOKIE = "pg_home";
export type HomeChoice = "overview" | "library";
export const parseHomeChoice = (value: string | undefined): HomeChoice => value === "library" ? "library" : "overview";
export const homeCookie = (choice: HomeChoice) => `${HOME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
