# ============================================
# CacheBash MCP Server - Dockerfile
# ============================================
# Multi-stage build for running CacheBash locally
# Usage: docker build -t cachebash .
#        docker run -p 3001:3001 --env-file .env cachebash

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:18-alpine AS deps

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY services/mcp-server/package*.json ./services/mcp-server/

# Install dependencies
RUN npm ci --workspace=services/mcp-server

# ============================================
# Stage 2: Build
# ============================================
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/mcp-server/node_modules ./services/mcp-server/node_modules

# Copy source files
COPY services/mcp-server/tsconfig.json ./services/mcp-server/
COPY services/mcp-server/src ./services/mcp-server/src
COPY services/mcp-server/package.json ./services/mcp-server/

# Build TypeScript
RUN cd services/mcp-server && npm run build

# ============================================
# Stage 3: Runtime
# ============================================
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY services/mcp-server/package*.json ./services/mcp-server/
RUN npm ci --workspace=services/mcp-server --omit=dev

# Copy built application
COPY --from=builder /app/services/mcp-server/dist ./services/mcp-server/dist
COPY services/mcp-server/package.json ./services/mcp-server/

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
WORKDIR /app/services/mcp-server
CMD ["node", "dist/index.js"]
