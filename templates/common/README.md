# ⏣ Titan Project

Welcome to your new **Titan Planet** project! Titan is a high-performance web framework designed for scale, speed, and developer happiness.

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
Run the project in development mode with hot-reloading:
```bash
titan dev
```

### 3. Build for Production
Create a self-contained production bundle in the `build/` directory:
```bash
titan build --release
```

### 4. Run Production Server
```bash
cd build
titan start
```

---

## 📂 Project Structure

- `app/actions/` - Your JavaScript/TypeScript backend logic.
- `public/` - Static assets served directly (images, robots.txt, etc.).
- `tanfig.json` - Core project configuration and build settings.
- `.env` - Environment variables.

---

## 🛠 Configuration (`tanfig.json`)

Your project uses `tanfig.json` to control the build and runtime behavior.

```json
{
  "name": "my-titan-app",
  "build": {
    "purpose": "test",
    "files": ["public", "static", "db", "config"]
  }
}
```

### Build Options:
- **`purpose`**: 
  - `test`: (Default) Creates a `node_modules` junction for local testing.
  - `deploy`: Slim build without `node_modules`, ready for production.
- **`files`**: List of folders/files from the root to include in the production `build/` folder.

---

## 🐳 Docker Deployment

This project comes with a pre-configured, multi-stage `Dockerfile` optimized for Titan's native engine.

### Build Image
```bash
docker build -t my-titan-app .
```

### Run Container
```bash
docker run -p 5100:5100 my-titan-app
```

---

## 🌐 Community & Support

- **Documentation**: [titanpl.vercel.app](https://titanpl.vercel.app)
- **GitHub**: [github.com/t8nlab/titanpl](https://github.com/t8nlab/titanpl)
- **Discord**: [Join our community](https://discord.gg/titanpl)

Built with ❤️ by the **Titan Planet** team.
