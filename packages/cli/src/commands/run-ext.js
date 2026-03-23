import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import http from 'node:http';

/**
 * Runs the extension sandbox using a native Node.js server (zero dependencies).
 */
export async function runExtensionCommand() {
    const titanJsonPath = path.join(process.cwd(), 'titan.json');
    if (!fs.existsSync(titanJsonPath)) {
        console.log(chalk.red("✖ No titan.json found in current directory."));
        return;
    }

    const titanJson = JSON.parse(fs.readFileSync(titanJsonPath, 'utf8'));
    const port = 3000;

    const server = http.createServer((req, res) => {
        if (req.url === '/test' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Titan Extension Sandbox - ${titanJson.name}</title>
    <style>
        body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
        .container { max-width: 800px; margin: 0 auto; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); }
        h1 { color: #38bdf8; margin-top: 0; display: flex; align-items: center; gap: 1rem; }
        .badge { background: #0ea5e9; color: white; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .method-list { margin-top: 2rem; }
        .method-item { background: #334155; padding: 1rem; margin-bottom: 1rem; border-radius: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
        .method-name { font-family: monospace; font-weight: bold; color: #7dd3fc; }
        button { background: #38bdf8; color: #0f172a; border: none; padding: 0.5rem 1.25rem; border-radius: 0.375rem; cursor: pointer; font-weight: 600; transition: all 0.2s; }
        button:hover { background: #7dd3fc; transform: translateY(-1px); }
        .output-container { margin-top: 2rem; }
        pre { background: #020617; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #1e293b; color: #10b981; overflow-x: auto; font-family: 'Fira Code', monospace; line-height: 1.5; }
        .log-entry { margin-bottom: 0.5rem; }
        .status-ok { color: #10b981; }
        .status-call { color: #fbbf24; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>
                Extension Sandbox 
                <span class="badge">${titanJson.type}</span>
            </h1>
            <p>Testing extension: <code style="color: #38bdf8;">${titanJson.name}</code> v${titanJson.version}</p>
            
            <div class="method-list">
                <div class="method-item">
                    <span class="method-name">hello()</span>
                    <button onclick="callMethod('hello', [])">Invoke</button>
                </div>
                <!-- Dynamic methods would be listed here -->
            </div>

            <div class="output-container">
                <h3>Live Output Log</h3>
                <pre id="output"><div class="log-entry status-ok">[System] Sandbox ready at localhost:${port}</div></pre>
            </div>
        </div>
    </div>

    <script>
        const output = document.getElementById('output');
        function log(msg, type = 'ok') {
            const entry = document.createElement('div');
            entry.className = 'log-entry status-' + type;
            entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${msg}\`;
            output.appendChild(entry);
            output.scrollTop = output.scrollHeight;
        }

        async function callMethod(name, args) {
            log(\`Calling \${name}...\`, 'call');
            try {
                // In a real sandbox this would fetch a /call endpoint
                const res = "Hello from ${titanJson.name}!";
                log(\`Result: \${JSON.stringify(res)}\`, 'ok');
            } catch (e) {
                log(\`Error: \${e.message}\`, 'error');
            }
        }
    </script>
</body>
</html>`);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(port, () => {
        console.log(chalk.cyan(`\n🪐 Titan Extension Sandbox running at:`));
        console.log(chalk.bold(`  http://localhost:${port}/test\n`));
        console.log(chalk.gray(`  Press Ctrl+C to stop.\n`));
    });
}
