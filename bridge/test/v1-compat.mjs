// Checks that every v1 tool is still exposed with the same name, description and input schema.
// Usage: node test/v1-compat.mjs <old server.mjs> <new server.mjs>
// Starts both as MCP servers over stdio (no Premiere needed) and compares tools/list.
import { spawn } from "node:child_process";

function listTools(serverPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`${serverPath}: no answer`));
    }, 15000);
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
        } else if (msg.id === 2) {
          clearTimeout(timer);
          p.kill();
          resolve(msg.result.tools);
        }
      }
    });
    p.on("error", reject);
    p.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "compat-test", version: "1" } } }) + "\n"
    );
  });
}

const [oldPath, newPath] = process.argv.slice(2);
const oldTools = await listTools(oldPath);
const newTools = await listTools(newPath);
const byName = new Map(newTools.map((t) => [t.name, t]));
let bad = 0;
for (const t of oldTools) {
  const n = byName.get(t.name);
  if (!n) {
    console.log(`MISSING  ${t.name}`);
    bad++;
    continue;
  }
  const same = JSON.stringify(t) === JSON.stringify(n);
  if (!same) {
    console.log(`CHANGED  ${t.name}`);
    bad++;
  }
}
const added = newTools.filter((t) => !oldTools.some((o) => o.name === t.name)).map((t) => t.name);
console.log(`v1 tools: ${oldTools.length}, identical in new server: ${oldTools.length - bad}. New tools: ${added.length}`);
console.log(added.join(", "));
process.exit(bad ? 1 : 0);
