import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` must stay on the server. Bundling it into a client chunk would ship
  // DATABASE_URL handling code to the browser.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
