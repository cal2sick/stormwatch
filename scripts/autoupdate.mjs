#!/usr/bin/env node
// Stormwatch auto-update supervisor: `npm run start:auto`.
// Runs the app, checks the current branch's upstream every STORMWATCH_UPDATE_SECONDS (default 120),
// and when there is a new commit: fast-forward pull, npm install (only if a lockfile/package.json changed),
// rebuild the web app, restart the server. The open browser tab sees a new /api/version and reloads itself.
// Safety: never resets, stashes or overwrites your changes. If the working tree is dirty (other than npm's
// package-lock.json churn) or the branch has diverged, it logs why and skips that update.
// Plain Node, no extra installs.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, lockfilesChanged } from "./autoupdate-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVERY = Math.max(10, Number(process.env.STORMWATCH_UPDATE_SECONDS) || 120) * 1000;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const log = (...a) => console.log(`[auto-update ${new Date().toLocaleTimeString()}]`, ...a);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: opts.inherit ? "inherit" : "pipe", env: process.env });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const git = (...a) => run("git", a);
/** Tracked files with local changes (staged or not). */
const changedFiles = () => git("diff", "--name-only", "HEAD").out.split("\n").filter(Boolean);

let child = null, stopping = false, restarting = false, crashes = 0;
function startServer() {
  child = spawn(NPM, ["run", "start", "-w", "server"], { cwd: ROOT, stdio: "inherit", detached: process.platform !== "win32", env: process.env });
  const me = child;
  me.on("exit", (code, sig) => {
    if (me !== child || stopping || restarting) return;
    crashes++;
    const wait = Math.min(60, 2 ** crashes) * 1000;
    log(`server exited (${code ?? sig}); restarting in ${wait / 1000}s`);
    setTimeout(() => { if (!stopping) startServer(); }, wait);
  });
  setTimeout(() => { if (me === child) crashes = 0; }, 60_000);
}
function stopServer() {
  return new Promise((res) => {
    const c = child; if (!c || c.exitCode !== null || c.signalCode) return res();
    c.once("exit", () => res());
    try { process.platform === "win32" ? c.kill() : process.kill(-c.pid, "SIGTERM"); } catch { c.kill(); }
    setTimeout(() => { try { process.platform === "win32" ? c.kill("SIGKILL") : process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } }, 8000);
  });
}
function build() {
  log("building web app");
  return run(NPM, ["run", "build", "-w", "web"], { inherit: true }).ok;
}

let busy = false;
async function check() {
  if (busy) return; busy = true;
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
    const up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
    if (!up.ok) { log(`branch "${branch}" has no upstream; skipping`); return; }
    if (!git("fetch", "--quiet").ok) { log("git fetch failed (offline?); will retry"); return; }
    const counts = git("rev-list", "--left-right", "--count", "HEAD...@{u}").out.split(/\s+/).map(Number);
    const dirty = changedFiles();
    const d = decide({ ahead: counts[0] || 0, behind: counts[1] || 0, dirty });
    if (d.action === "none") return;
    if (d.action === "skip") { log(d.reason); return; }
    if (d.action === "reset-lock") { log("discarding npm's package-lock.json churn"); git("checkout", "--", "package-lock.json"); }
    const before = git("rev-parse", "HEAD").out;
    const pull = git("pull", "--ff-only", "--quiet");
    if (!pull.ok) { log("git pull --ff-only failed; skipping:", pull.err); return; }
    const after = git("rev-parse", "HEAD").out;
    log(`updated ${before.slice(0, 7)} -> ${after.slice(0, 7)} (${up.out})`);
    const changed = git("diff", "--name-only", before, after).out.split("\n");
    if (lockfilesChanged(changed)) {
      log("dependencies changed: npm install");
      if (!run(NPM, ["install", "--no-audit", "--no-fund"], { inherit: true }).ok) { log("npm install failed; keeping the running server"); return; }
      if (changedFiles().every((f) => f === "package-lock.json")) git("checkout", "--", "package-lock.json");
    }
    if (!build()) { log("build failed; keeping the running server (fix will arrive with the next commit)"); return; }
    restarting = true; await stopServer(); restarting = false;
    startServer();
    log("server restarted; open tabs will reload by themselves");
  } catch (e) { log("check failed:", e?.message ?? e); }
  finally { busy = false; }
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { stopping = true; await stopServer(); process.exit(0); });

if (!build()) { log("first build failed"); process.exit(1); }
startServer();
log(`watching for updates every ${EVERY / 1000}s on branch ${git("rev-parse", "--abbrev-ref", "HEAD").out}`);
setInterval(check, EVERY);
