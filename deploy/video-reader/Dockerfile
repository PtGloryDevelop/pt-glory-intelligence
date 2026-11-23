# The video reader for an always-on server (the same VPS as deploy/owned-sync). Built from the
# repository root by deploy/video-reader/docker-compose.yml; see deploy/video-reader/README.md.
FROM node:24-bookworm-slim

# ffmpeg/ffprobe cut the frames and the audio. Debian's package, no third-party build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Runtime dependencies only, pinned by the lockfile, no install scripts: pg and the Supabase client.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
# Named copies, not `COPY . .`, so nothing else in the checkout (a stray .env, a key) reaches the image.
COPY scripts ./scripts
COPY lib ./lib

USER node
CMD ["node", "--conditions=react-server", "--experimental-strip-types", "scripts/video-reader.mjs"]
