import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForOutput(child, pattern) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), 10_000);

    function onData(chunk) {
      output += chunk.toString("utf8");
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve();
      }
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited early with ${code}: ${output}`));
    });
  });
}

async function requestThroughMitmProxy(proxyPort, targetPort) {
  const socket = net.connect(proxyPort, "127.0.0.1");
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(
    `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${targetPort}\r\n\r\n`,
    "utf8",
  );

  let connectResponse = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for CONNECT response")), 5_000);
    socket.on("data", function onData(chunk) {
      connectResponse += chunk.toString("latin1");
      if (connectResponse.includes("\r\n\r\n")) {
        socket.off("data", onData);
        clearTimeout(timer);
        resolve();
      }
    });
    socket.once("error", reject);
  });
  assert.match(connectResponse, /^HTTP\/1\.1 200 Connection Established/);

  const tlsSocket = tls.connect({ socket, servername: "127.0.0.1", rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    tlsSocket.once("secureConnect", resolve);
    tlsSocket.once("error", reject);
  });

  const body = "{}";
  tlsSocket.write(
    `POST /v1/messages HTTP/1.1\r\n` +
    `Host: 127.0.0.1\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
    body,
    "utf8",
  );

  let response = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for proxy response")), 5_000);
    tlsSocket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    tlsSocket.once("error", reject);
    tlsSocket.once("end", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  tlsSocket.destroy();
  return response;
}

test("MITM upstream connection failure returns 502 without crashing proxy", async () => {
  const proxyPort = await getFreePort();
  const unusedTargetPort = await getFreePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotmask-proxy-test-"));
  const dotmaskDir = path.join(home, ".dotmask");
  fs.mkdirSync(dotmaskDir, { recursive: true });
  fs.writeFileSync(
    path.join(dotmaskDir, "config.json"),
    JSON.stringify({ allowedHosts: ["127.0.0.1"] }),
    "utf8",
  );

  const child = spawn(process.execPath, ["dist/proxy/server.js", "--port", String(proxyPort)], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, USERPROFILE: home, DOTMASK_DEBUG: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForOutput(child, /proxy listening/);

    const response = await requestThroughMitmProxy(proxyPort, unusedTargetPort);
    assert.match(response, /^HTTP\/1\.1 502 Bad Gateway/);

    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(home, { recursive: true, force: true });
  }
});
