# ============================================
# CacheBash MCP Server - Dockerfile
# ============================================
# Multi-stage build treating mcp-server as standalone
# Usage: docker build -t cachebash .
#        docker run -p 3001:3001 --env-file .env cachebash

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:25-alpine AS deps

WORKDIR /app

# Install from the lockfile so the image resolves the exact versions in git.
# npm ci fails if package.json and package-lock.json disagree.
COPY services/mcp-server/package.json services/mcp-server/package-lock.json ./
RUN npm ci

# ============================================
# Stage 2: Build
# ============================================
FROM node:25-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY services/mcp-server/package.json ./
COPY services/mcp-server/tsconfig.json ./
COPY services/mcp-server/src ./src

# Build TypeScript
RUN npm run build

# ============================================
# Stage 3: Runtime
# ============================================
FROM node:25-alpine

WORKDIR /app

# Install production dependencies only, from the lockfile
COPY services/mcp-server/package.json services/mcp-server/package-lock.json ./
RUN npm ci --omit=dev

# Copy built application
COPY --from=builder /app/dist ./dist

# Build identity for /v1/health (src/utils/buildInfo.ts). Precedence per field:
#   1. build-info.json, written by scripts/deploy-mcp.sh (file wins if present)
#   2. GIT_SHA / BUILD_TIME env, from these ARGs (local: docker build --build-arg GIT_SHA=...)
#   3. "unknown"
# The glob build-info.jso[n] matches zero or one file, so the build still
# succeeds when the file is absent (plain docker build, or a bare
# `gcloud run deploy --source .` not made through the wrapper). package.json
# is a second source so the COPY always has at least one match.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
COPY services/mcp-server/package.json services/mcp-server/build-info.jso[n] ./

# Set up non-root user for security
RUN addgroup -g 1001 -S cachebash && \
    adduser -S cachebash -u 1001 && \
    chown -R cachebash:cachebash /app

USER cachebash

# Expose MCP server port
EXPOSE 3001

# Set environment defaults
ENV PORT=3001
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/v1/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the MCP server
CMD ["node", "dist/index.js"]
