# ================================================================
# STAGE 1 — Build TitanPl
# ================================================================
FROM node:20.20.0-slim AS builder

WORKDIR /app

# Install native dependencies in case of native modules or hybrids
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential pkg-config libssl-dev git bash \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# ---------- Node Dependencies ----------
COPY package.json package-lock.json* ./
RUN npm install

# ---------- Copy Project ----------
COPY . .

# Run the Titan build command (compiles dist/)
RUN npx titan build

# ================================================================
# STAGE 2 — Gravity Engine (Production Ready)
# ================================================================
FROM node:20.20.0-slim

WORKDIR /app

# Ensure we have required OS-level certs if doing network fetching
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# ---- Copy Production package.json and install ONLY dependencies ----
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Copy Dist Build from Builder ----
COPY --from=builder /app/dist ./dist

# ---------------- OPTIONAL APP FOLDERS ----------------
# Static assets
# COPY --from=builder /app/app/static ./static

# Public assets
# COPY --from=builder /app/app/public ./public

# DB
# COPY --from=builder /app/app/db ./db

# ---- Create User After Copy ----
RUN useradd -m titan && chown -R titan:titan /app
USER titan

# ---- Platform Defaults ----
ENV HOST=0.0.0.0
ENV PORT=5100
ENV TITAN_DEV=0

EXPOSE 5100

# ---- Force Foreground Process via Titan CLI ----
CMD ["npx", "titan", "start"]
