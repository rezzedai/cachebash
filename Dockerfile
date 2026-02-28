# ============================================
# CacheBash MCP Server - Dockerfile
# ============================================
# Multi-stage build treating mcp-server as standalone
# Usage: docker build -t cachebash .
#        docker run -p 3001:3001 --env-file .env cachebash

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files and install dependencies
COPY services/mcp-server/package*.json ./
RUN npm ci

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY services/mcp-server/package*.json ./
RUN npm ci --omit=dev

# Copy built application
COPY --from=builder /app/dist ./dist
COPY services/mcp-server/package.json ./

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
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the MCP server
CMD ["node", "dist/index.js"]
