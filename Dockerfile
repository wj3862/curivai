# ─── Stage 1: Build web frontend ─────────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app/web

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy web package files
COPY web/package.json web/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy web source and build
COPY web/ ./
RUN pnpm build

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Install pnpm and system deps
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache python3 make g++

# Copy backend package files
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

# Copy source code (tsx runs TypeScript directly)
COPY src/ ./src/
COPY tsconfig.json ./

# Copy built web assets from web-builder
COPY --from=web-builder /app/web/dist /app/dist/web

# Copy data files
COPY personas/ ./personas/
COPY radar_packs/ ./radar_packs/
COPY presets/ ./presets/
COPY templates/ ./templates/

# Create data directory
RUN mkdir -p /data

# Environment
ENV NODE_ENV=production
ENV CURIVAI_CONFIG=/data/config.yaml

EXPOSE 3891

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3891/api/health || exit 1

CMD ["node", "--import", "tsx/esm", "src/cli/index.ts", "server"]
