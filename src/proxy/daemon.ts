import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOTMASK_DIR, CA_DIR } from "./cert.js";
import {
  buildMacLaunchdPlist,
  buildWindowsTaskCommand,
  parseLinuxPidFile,
  requireSupportedPlatform,
} from "../platform/daemon.js";

const LABEL = "com.dotmask.proxy";
const WINDOWS_TASK_NAME = "dotmask-proxy";
const PLIST_PATH = path.join(
  os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`,
);
const LOG_PATH = path.join(DOTMASK_DIR, "proxy.log");
const ERR_PATH = path.join(DOTMASK_DIR, "proxy.err.log");
const LINUX_PID_PATH = path.join(DOTMASK_DIR, "proxy.pid.json");

function proxyBinPath(): string {
  const distDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..",
  );
  return path.join(distDir, "dist", "proxy", "server.js");
}

function nodeBin(): string {
  return process.execPath;
}

function buildPlist(port: number): string {
  return buildMacLaunchdPlist(nodeBin(), proxyBinPath(), port, {
    label: LABEL,
    caDir: CA_DIR,
    stdoutPath: LOG_PATH,
    stderrPath: ERR_PATH,
  });
}

export function installDaemon(port: number): void {
  requireSupportedPlatform("dotmask install");

  if (process.platform === "win32") {
    installWindowsTask(port);
    return;
  }
  if (process.platform === "linux") {
    installLinuxDaemon(port);
    return;
  }

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.mkdirSync(DOTMASK_DIR, { recursive: true });

  if (isDaemonLoaded()) {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe" });
  }

  fs.writeFileSync(PLIST_PATH, buildPlist(port), "utf8");
  execFileSync("launchctl", ["load", "-w", PLIST_PATH], { stdio: "pipe" });
}

export function uninstallDaemon(): void {
  requireSupportedPlatform("dotmask uninstall");

  if (process.platform === "win32") {
    uninstallWindowsTask();
    return;
  }
  if (process.platform === "linux") {
    uninstallLinuxDaemon();
    return;
  }

  if (fs.existsSync(PLIST_PATH)) {
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe" });
    } catch {
      // Already unloaded.
    }
    fs.rmSync(PLIST_PATH, { force: true });
  }
}

export function isDaemonLoaded(): boolean {
  if (process.platform === "win32") {
    try {
      const result = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME], { encoding: "utf8" });
      return result.status === 0;
    } catch {
      return false;
    }
  }
  if (process.platform === "linux") {
    return readLinuxDaemonState() !== null;
  }

  try {
    const result = spawnSync("launchctl", ["list", LABEL], { encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isDaemonRunning(): boolean {
  if (process.platform === "win32") {
    try {
      const result = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME, "/V", "/FO", "LIST"], { encoding: "utf8" });
      return result.status === 0 && /Status:\s+Running/i.test(result.stdout);
    } catch {
      return false;
    }
  }
  if (process.platform === "linux") {
    const state = readLinuxDaemonState();
    if (!state) return false;
    return isPidRunning(state.pid);
  }

  if (!isDaemonLoaded()) return false;
  try {
    const result = spawnSync("launchctl", ["list", LABEL], { encoding: "utf8" });
    return result.status === 0 && result.stdout.includes('"PID"');
  } catch {
    return false;
  }
}

export function getDaemonPort(): number | null {
  if (process.platform === "win32") {
    try {
      const result = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME, "/XML"], { encoding: "utf8" });
      if (result.status !== 0) return null;
      const match = /--port\s+(\d+)/.exec(result.stdout);
      if (!match) return null;
      const port = Number.parseInt(match[1], 10);
      return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "linux") {
    return readLinuxDaemonState()?.port ?? null;
  }

  if (!fs.existsSync(PLIST_PATH)) return null;

  try {
    const plist = fs.readFileSync(PLIST_PATH, "utf8");
    const match = /<string>--port<\/string>\s*<string>(\d+)<\/string>/.exec(plist);
    if (!match) return null;

    const port = Number.parseInt(match[1], 10);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

function installWindowsTask(port: number): void {
  fs.mkdirSync(DOTMASK_DIR, { recursive: true });
  fs.mkdirSync(CA_DIR, { recursive: true });

  execFileSync("schtasks", [
    "/Create",
    "/TN", WINDOWS_TASK_NAME,
    "/TR", buildWindowsTaskCommand(nodeBin(), proxyBinPath(), port),
    "/SC", "ONLOGON",
    "/RL", "LIMITED",
    "/F",
  ], { stdio: "pipe" });

  try {
    execFileSync("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME], { stdio: "pipe" });
  } catch {
    // Task remains registered and starts next login.
  }
}

function uninstallWindowsTask(): void {
  try {
    execFileSync("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME], { stdio: "pipe" });
  } catch {
    // Already stopped or never started.
  }
  try {
    execFileSync("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"], { stdio: "pipe" });
  } catch {
    // Already removed.
  }
}

function installLinuxDaemon(port: number): void {
  fs.mkdirSync(DOTMASK_DIR, { recursive: true });
  fs.mkdirSync(CA_DIR, { recursive: true });

  const existing = readLinuxDaemonState();
  if (existing && isPidRunning(existing.pid)) {
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }

  const stdout = fs.openSync(LOG_PATH, "a");
  const stderr = fs.openSync(ERR_PATH, "a");
  const child = spawn(nodeBin(), [proxyBinPath(), "--port", String(port)], {
    detached: true,
    stdio: ["ignore", stdout, stderr],
    env: {
      ...process.env,
      DOTMASK_CA_DIR: CA_DIR,
      DOTMASK_DEBUG: process.env.DOTMASK_DEBUG ?? "0",
    },
  });

  child.unref();
  fs.writeFileSync(
    LINUX_PID_PATH,
    JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

function uninstallLinuxDaemon(): void {
  const state = readLinuxDaemonState();
  if (state && isPidRunning(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  fs.rmSync(LINUX_PID_PATH, { force: true });
}

function readLinuxDaemonState(): { pid: number; port: number } | null {
  if (!fs.existsSync(LINUX_PID_PATH)) return null;
  const state = parseLinuxPidFile(fs.readFileSync(LINUX_PID_PATH, "utf8"));
  if (!state) return null;
  return state;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
