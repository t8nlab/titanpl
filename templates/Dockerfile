# Stage 1 — Build Titan (JS → Rust)
FROM rust:1.91.1 AS builder

# Install Node for Titan CLI
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install Titan CLI AND its required dependencies
RUN npm install -g @ezetgalaxy/titan esbuild chokidar

WORKDIR /app

# Copy project
COPY . .

# Install Titan dependencies LOCALLY
RUN npm install esbuild chokidar

# Build Titan metadata (routes + bundles)
RUN tit build

# Build Rust release binary
RUN cd server && cargo build --release

# Stage 2 — Run Titan server
FROM debian:stable-slim

WORKDIR /app

# Copy final Rust binary
COPY --from=builder /app/server/target/release/server ./titan-server

# Copy Titan runtime files
COPY --from=builder /app/server/routes.json .
COPY --from=builder /app/server/action_map.json .
COPY --from=builder /app/server/actions ./actions

EXPOSE 3000

CMD ["./titan-server"]
