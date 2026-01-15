# ================================================================
# STAGE 1 — Build Titan (JS → Rust)
# ================================================================
FROM rust:1.91.1 AS builder

# Install Node for Titan CLI + bundler
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install Titan CLI (latest)
RUN npm install -g @ezetgalaxy/titan@latest

WORKDIR /app

# Copy project files
COPY . .

# Install JS dependencies (needed for Titan DSL + bundler)
RUN npm install

SHELL ["/bin/bash", "-c"]

# Extract Titan extensions into .ext
RUN mkdir -p /app/.ext && \
    find /app/node_modules -maxdepth 5 -type f -name "titan.json" -print0 | \
    while IFS= read -r -d '' file; do \
    pkg_dir="$(dirname "$file")"; \
    pkg_name="$(basename "$pkg_dir")"; \
    echo "Copying Titan extension: $pkg_name from $pkg_dir"; \
    cp -r "$pkg_dir" "/app/.ext/$pkg_name"; \
    done && \
    echo "Extensions in .ext:" && \
    ls -R /app/.ext

# Build Titan metadata + bundle JS actions
RUN titan build

# Build Rust binary
RUN cd server && cargo build --release



# ================================================================
# STAGE 2 — Runtime Image (Lightweight)
# ================================================================
FROM debian:stable-slim

WORKDIR /app

# Copy Rust binary from builder stage
COPY --from=builder /app/server/target/release/titan-server ./titan-server

# Copy Titan routing metadata
COPY --from=builder /app/server/routes.json ./routes.json
COPY --from=builder /app/server/action_map.json ./action_map.json

# Copy Titan JS bundles
RUN mkdir -p /app/actions
COPY --from=builder /app/server/actions /app/actions

# Copy only Titan extensions
COPY --from=builder /app/.ext ./.ext

EXPOSE 3000

CMD ["./titan-server"]
