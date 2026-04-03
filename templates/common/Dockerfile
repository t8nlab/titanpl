# ================================================================
# STAGE 1 — Builder
# ================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TITAN_DEV=0

# Copy dependency files
COPY package.json package-lock.json* ./

# Install Titan CLI and dependencies
RUN npm install -g @titanpl/cli
RUN npm install --include=optional

# Copy source code
COPY . .

# Build the Titan app
RUN titan build --release

# ================================================================
# STAGE 2 — Runtime
# ================================================================
FROM ubuntu:24.04

WORKDIR /app

# Minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Create dedicated user
RUN groupadd -r titan && useradd -r -g titan titan

# Copy ALL contents from builder stage build/ directory to current WORKDIR
COPY --from=builder /app/build/ ./

# Map .ext into 'dist' and 'app' to satisfy all potential loader paths.
RUN ln -s /app/.ext /app/dist/.ext || true && \
    ln -s /app/.ext /app/app/.ext || true

# Fix ownership
RUN chown -R titan:titan /app

# Environment variables
ENV HOST=0.0.0.0
ENV PORT=5100
ENV TITAN_DEV=0
# Help the dynamic linker find the .so files
ENV LD_LIBRARY_PATH=/app/.ext/@titanpl/core/native/target/release

USER titan
EXPOSE 5100

# Run the native server executable
CMD ["./titan-server", "run", "dist"]