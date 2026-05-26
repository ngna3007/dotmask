import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformName } from "../platform/daemon.js";

export const DOTMASK_DIR = path.join(os.homedir(), ".dotmask");
export const CA_DIR = path.join(DOTMASK_DIR, "ca");
export const CA_CERT_PATH = path.join(CA_DIR, "ca.pem");
export const CA_KEY_PATH = path.join(CA_DIR, "ca.key.pem");

const KEYCHAIN_CERT_LABEL = "dotmask-proxy-ca";
const LOGIN_KEYCHAIN_PATH = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}

function extractPemBlocks(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

/** Check whether the CA cert is already trusted by the current OS user store. */
export function isCertTrusted(): boolean {
  if (!certExists()) return false;

  if (process.platform === "win32") {
    try {
      const result = spawnSync("certutil", ["-user", "-store", "Root", KEYCHAIN_CERT_LABEL], { encoding: "utf8" });
      return result.status === 0 && result.stdout.includes(KEYCHAIN_CERT_LABEL);
    } catch {
      return false;
    }
  }

  if (process.platform === "linux") return true;

  if (process.platform !== "darwin") return false;

  try {
    const result = spawnSync("security", [
      "find-certificate", "-c", KEYCHAIN_CERT_LABEL, "-a", "-p",
      LOGIN_KEYCHAIN_PATH,
    ], { encoding: "utf8" });
    if (result.status !== 0) return false;

    const currentCert = normalizePem(fs.readFileSync(CA_CERT_PATH, "utf8"));
    return extractPemBlocks(result.stdout).some((pem) => normalizePem(pem) === currentCert);
  } catch {
    return false;
  }
}

/** Check whether the CA cert files exist on disk. */
export function certExists(): boolean {
  return fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH);
}

/**
 * Install the CA cert into the current user's trust store.
 * macOS may trigger a password/Touch ID prompt.
 */
export function installCert(): boolean {
  if (!certExists()) return false;

  if (process.platform === "win32") {
    try {
      execFileSync("certutil", ["-user", "-addstore", "Root", CA_CERT_PATH], { stdio: "inherit" });
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "linux") return true;

  if (process.platform !== "darwin") return false;

  try {
    execFileSync("security", [
      "add-trusted-cert",
      "-d",
      "-r", "trustRoot",
      "-k", LOGIN_KEYCHAIN_PATH,
      CA_CERT_PATH,
    ], { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

/** Remove the dotmask CA cert from the current user's trust store. */
export function uninstallCert(): void {
  if (process.platform === "win32") {
    try {
      execFileSync("certutil", ["-user", "-delstore", "Root", KEYCHAIN_CERT_LABEL], { stdio: "pipe" });
    } catch { /* already removed */ }
    return;
  }

  if (process.platform === "linux") return;

  if (process.platform !== "darwin") {
    throw new Error(`certificate uninstall is not supported on ${getPlatformName()}`);
  }

  try {
    execFileSync("security", [
      "delete-certificate",
      "-c", KEYCHAIN_CERT_LABEL,
      LOGIN_KEYCHAIN_PATH,
    ], { stdio: "pipe" });
  } catch { /* already removed */ }
}
