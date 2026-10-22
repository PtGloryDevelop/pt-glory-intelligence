# The "แอดของเรา" sync for an always-on server (the Ads Management VPS). Built from the repository
# root by deploy/owned-sync/docker-compose.yml; see deploy/owned-sync/README.md.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
# Runtime dependencies only, pinned by the lockfile. No install scripts: these jobs need pg and the
# Supabase client, nothing that compiles.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
# Named copies, not `COPY . .`, so nothing else in the checkout (a stray .env, a key) reaches the image.
COPY scripts ./scripts
COPY lib ./lib

USER node
CMD ["node", "scripts/owned-sync-loop.mjs"]
