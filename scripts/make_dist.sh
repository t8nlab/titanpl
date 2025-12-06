#!/usr/bin/env bash
set -e

echo "Building Titan distribution..."

# ---------------------------------------------
# Resolve directories
# ---------------------------------------------
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/server"
DIST_DIR="$ROOT/dist"

# Clean and recreate dist/
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ---------------------------------------------
# Copy release binary titan-server
# ---------------------------------------------
RELEASE_PATH="$SERVER_DIR/target/release"

echo "Looking for titan-server binary..."

if [ -f "$RELEASE_PATH/titan-server" ]; then
    echo "✓ Found titan-server"
    cp "$RELEASE_PATH/titan-server" "$DIST_DIR/"
else
    echo "Binary not found directly, searching..."
    BIN=$(ls "$RELEASE_PATH" | grep 'titan-server' || true)

    if [ -n "$BIN" ]; then
        echo "✓ Found matching binary: $BIN"
        cp "$RELEASE_PATH/$BIN" "$DIST_DIR/titan-server"
    else
        echo "✗ titan-server binary not found in release folder."
        echo "Did you run: cargo build --release ?"
        exit 1
    fi
fi

# ---------------------------------------------
# routes.json (JS bundler should generate routes.build.json)
# ---------------------------------------------
if [ -f "$ROOT/routes.build.json" ]; then
    echo "✓ Using routes.build.json"
    cp "$ROOT/routes.build.json" "$DIST_DIR/routes.json"
else
    echo "⚠ No routes.build.json found. Creating empty routes.json"
    echo "{}" > "$DIST_DIR/routes.json"
fi

# ---------------------------------------------
# Copy handlers if they exist
# ---------------------------------------------
mkdir -p "$DIST_DIR/handlers"

if [ -d "$ROOT/handlers" ]; then
    echo "✓ Copying handlers/"
    cp -r "$ROOT/handlers/"* "$DIST_DIR/handlers/" 2>/dev/null || true
else
    echo "⚠ No handlers/ directory found."
fi

echo ""
echo "-------------------------------------------"
echo " ✔ Titan dist/ build complete"
echo "-------------------------------------------"
echo "Binary:     dist/titan-server"
echo "Routes:     dist/routes.json"
echo "Handlers:   dist/handlers/"
echo ""
