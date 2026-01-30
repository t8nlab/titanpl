# ================================================================
# STAGE 1 — Build TitanPl
# ================================================================
FROM node:20.20.0-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential pkg-config libssl-dev git bash \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
       sh -s -- -y --default-toolchain stable --profile minimal \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:${PATH}"
ENV NODE_ENV=production
ENV RUSTFLAGS="-C target-cpu=native -C strip=symbols"

WORKDIR /app

# ---------- Rust Cache ----------
RUN mkdir -p server/src
COPY server/Cargo.toml server/Cargo.lock* server/
RUN echo "fn main(){}" > server/src/main.rs
WORKDIR /app/server
RUN cargo build --release
RUN rm src/main.rs
WORKDIR /app

# ---------- Node Cache ----------
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

RUN npm install -g @ezetgalaxy/titan@latest

# ---------- Copy Project ----------
COPY . .

RUN node app/app.js --build

# ---------- Extensions ----------
SHELL ["/bin/bash", "-c"]
RUN mkdir -p /app/.ext && \
    find /app/node_modules -type f -name "titan.json" -print0 | \
    while IFS= read -r -d '' file; do \
        pkg_dir="$(dirname "$file")"; \
        pkg_name="$(basename "$pkg_dir")"; \
        cp -r "$pkg_dir" "/app/.ext/$pkg_name"; \
        rm -rf "/app/.ext/$pkg_name/node_modules"; \
    done

RUN cd server && cargo build --release



# ================================================================
# STAGE 2 — Runtime (Render Safe)
# ================================================================
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Copy Files as root ----
COPY --from=builder /app/server/target/release/titan-server ./titan-server
COPY --from=builder /app/server/routes.json .
COPY --from=builder /app/server/action_map.json .
COPY --from=builder /app/server/src/actions ./actions
COPY --from=builder /app/app/static ./static
COPY --from=builder /app/.ext ./.ext

# ---- Ensure Executable ----
RUN chmod +x ./titan-server

# ---- Create User After Copy ----
RUN useradd -m titan && chown -R titan:titan /app
USER titan

# ---- Platform Defaults ----
ENV HOST=0.0.0.0
ENV PORT=5100

# ---- Verify Node Not Present ----
RUN which node || echo "NodeJS not present ✔"

EXPOSE 5100

# ---- Force Foreground Process ----
ENTRYPOINT ["./titan-server"]
