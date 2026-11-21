import { spawn, spawnSync } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 3210);
const base = `http://127.0.0.1:${port}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = ["run", "start", "--", "-p", String(port)];
const options = {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
};
const server = process.env.npm_execpath
  ? spawn(process.execPath, [process.env.npm_execpath, ...npmArgs], options)
  : spawn(npmCommand, npmArgs, {
      ...options,
      shell: process.platform === "win32",
    });
let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });
server.on("error", (error) => { output += `${error.message}\n`; });

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
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(-server.pid, "SIGTERM");
      }
    }
  } catch {}
}
