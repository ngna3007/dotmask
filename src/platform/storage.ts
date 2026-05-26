import crypto from "node:crypto";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "dotmask";
const DOTMASK_DIR = path.join(os.homedir(), ".dotmask");
const SECRET_STORE_DIR = path.join(DOTMASK_DIR, "secret-store");

function secretFile(fakeKey: string): string {
  const digest = crypto.createHash("sha256").update(fakeKey).digest("hex");
  return path.join(SECRET_STORE_DIR, `${digest}.json`);
}

function ensureStoreDir(): void {
  fs.mkdirSync(SECRET_STORE_DIR, { recursive: true });
  try {
    fs.chmodSync(SECRET_STORE_DIR, 0o700);
  } catch {
    // Windows ACLs do not use POSIX mode bits.
  }
}

function readPortableSecret(fakeKey: string): string | null {
  const file = secretFile(fakeKey);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { fake?: string; real?: string; encrypted?: string };
    if (parsed.fake !== fakeKey) return null;
    if (typeof parsed.real === "string") return parsed.real;
    if (typeof parsed.encrypted === "string") return decryptWindowsSecret(parsed.encrypted);
  } catch {
    return null;
  }
  return null;
}

function writePortableSecret(fakeKey: string, realValue: string): void {
  ensureStoreDir();
  const file = secretFile(fakeKey);
  const payload = process.platform === "win32"
    ? { fake: fakeKey, encrypted: encryptWindowsSecret(realValue) }
    : { fake: fakeKey, real: realValue };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ACLs do not use POSIX mode bits.
  }
}

function runPowerShell(script: string, input: string): string {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "PowerShell command failed");
  }
  return result.stdout;
}

function encryptWindowsSecret(value: string): string {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$plain = [Console]::In.ReadToEnd()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($plain)",
    "$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($encrypted))",
  ].join("; ");

  return runPowerShell(script, value).trim();
}

function decryptWindowsSecret(value: string): string {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$encrypted = [Console]::In.ReadToEnd()",
    "$bytes = [Convert]::FromBase64String($encrypted)",
    "$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))",
  ].join("; ");

  return runPowerShell(script, value);
}

export function lookupSecret(fakeKey: string): string | null {
  if (process.platform !== "darwin") {
    return readPortableSecret(fakeKey);
  }

  try {
    const result = execFileSync("security", [
      "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", fakeKey, "-w",
    ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

export async function lookupSecretAsync(fakeKey: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return readPortableSecret(fakeKey);
  }

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", fakeKey, "-w",
    ], { encoding: "utf8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function storeSecret(fakeKey: string, realValue: string): void {
  if (process.platform !== "darwin") {
    writePortableSecret(fakeKey, realValue);
    return;
  }

  try {
    execFileSync("security", [
      "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", fakeKey,
    ], { stdio: "pipe" });
  } catch {
    // ok - might not exist yet.
  }

  try {
    execFileSync("security", [
      "add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", fakeKey, "-w", realValue,
    ], { stdio: "pipe" });
  } catch (err) {
    throw new Error(
      `failed to store secret mapping for ${fakeKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
