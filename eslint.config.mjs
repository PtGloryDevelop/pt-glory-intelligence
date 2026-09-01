// eslint-config-next v16 ships flat config directly; no FlatCompat needed.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "supabase/**"] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
