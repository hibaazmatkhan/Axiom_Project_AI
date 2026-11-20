import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 3210);
const base = `http://127.0.0.1:${port}`;
const server = spawn("npm", ["run", "start", "--", "-p", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

const pages = [
  ["/", "Four players"],
  ["/lobby", "Choose your room."],
  ["/login", "The room"],
  ["/profile", "Checking credentials"],
  ["/reset-password", "New password"],
];

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start.\n${output}`);
}

try {
  await waitForServer();
  for (const [path, marker] of pages) {
    const response = await fetch(`${base}${path}`);
    const html = await response.text();
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    if (!html.includes(marker)) throw new Error(`${path} is missing marker: ${marker}`);
    if (/Text content did not match|Hydration failed|error while hydrating/i.test(html)) {
      throw new Error(`${path} contains a hydration error marker`);
    }
    process.stdout.write(`ok ${path}\n`);
  }
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
}
