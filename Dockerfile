# syntax=docker/dockerfile:1

# ---- Build: compile TypeScript once, on the build host's native platform ----
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Production dependencies, installed for the target platform ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime ----
FROM node:26-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/SyFizz/whatseerr" \
      org.opencontainers.image.description="Send Seerr (Jellyseerr) media notifications to a WhatsApp group" \
      org.opencontainers.image.licenses="GPL-3.0-only"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
# /data holds the WhatsApp session: it must be writable by the unprivileged user.
RUN mkdir -p /data && chown node:node /data
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
CMD ["node", "dist/index.js"]
