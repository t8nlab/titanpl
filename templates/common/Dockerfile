# ================================================================
# STAGE 1 — Builder
# ================================================================
FROM node:20-slim AS builder

WORKDIR /app

# build-essential is required for native Titan extensions (C++ or Rust based)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install with optional dependencies so it grabs the correct engine for the Linux builder
RUN npm install -g @titanpl/cli

RUN npm install --include=optional

COPY . .

# Run the Titan release build step (generates a 'build' folder)
RUN npx titan build --release


# ================================================================
# STAGE 2 — Runtime (Optimized Pure Engine)
# ================================================================
FROM ubuntu:24.04

# Use an unprivileged user for security
RUN groupadd -r titan && useradd -r -g titan titan

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Copy EVERYTHING from the generated build folder into Stage 2
# This includes dist/, .ext/, package.json, .env, and the titan-server binary
COPY --from=builder /app/build/ ./

# CRITICAL SYSTEM SETUP:
# Ensure the worker threads can find the extensions through the symlink
RUN ln -s /app/.ext /app/node_modules && \
    chown -R titan:titan /app

# Standard environment variables
ENV HOST=0.0.0.0
ENV PORT=5100
ENV TITAN_DEV=0

USER titan
EXPOSE 5100

# Health check to ensure the server is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5100/ || exit 1

# DYNAMIC ENTRYPOINT: Use the portable binary in the root of /app
CMD ["./titan-server", "start"]