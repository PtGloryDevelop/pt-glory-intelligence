import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * What commit is this build?
 *
 * A pilot team reporting "the number looked wrong" is only useful if we know
 * which build they were looking at. The deploy passes PT_GLORY_COMMIT in
 * (`--build-env`), because a CLI deploy uploads a directory rather than a git
 * clone and the build has no repository to ask. Locally, git answers directly.
 *
 * "unknown" is left as-is rather than faked: a wrong commit id is worse than an
 * absent one.
 */
function buildCommit(): string {
  if (process.env.PT_GLORY_COMMIT) return process.env.PT_GLORY_COMMIT;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // `pg` must stay on the server. Bundling it into a client chunk would ship
  // DATABASE_URL handling code to the browser.
  serverExternalPackages: ["pg"],
  experimental: {
    // `forbidden()` and the `forbidden.tsx` boundary. A page that refuses a role
    // has to answer 403 on the wire, not a 200 carrying a refusal in its body:
    // a script, a crawler or a client library reads the status, not the screen.
    authInterrupts: true,
  },
  env: {
    PT_GLORY_COMMIT: buildCommit(),
    PT_GLORY_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
