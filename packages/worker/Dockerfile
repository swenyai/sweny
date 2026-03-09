# sweny-worker — standalone job executor
#
# The worker receives jobs from a BullMQ queue, decrypts credentials in memory,
# and runs the SWEny engine. No direct database access required.
#
# Configuration is entirely via environment variables:
#   REDIS_URL          — BullMQ queue connection (e.g. redis://localhost:6379)
#   INTERNAL_API_URL   — sweny.ai internal API base URL (for secrets + result submission)
#
# Build:
#   docker buildx build --platform linux/amd64 -t swenyai/worker:$(git rev-parse --short HEAD) .
#
# Run:
#   docker run \
#     -e REDIS_URL=redis://... \
#     -e INTERNAL_API_URL=https://api.sweny.ai \
#     swenyai/worker:latest

FROM node:22-alpine AS base
WORKDIR /app

# Install production dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --production

# Copy compiled output
COPY dist/ ./dist/

# The worker is stateless — all configuration comes from environment variables
ENV NODE_ENV=production

# Drop to non-root user for defense in depth
RUN addgroup -S sweny && adduser -S sweny -G sweny
USER sweny

CMD ["node", "dist/index.js"]
