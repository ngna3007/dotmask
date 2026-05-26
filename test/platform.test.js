import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMacLaunchdPlist,
  buildWindowsTaskCommand,
  parseLinuxPidFile,
  getPlatformName,
  isSupportedPlatform,
} from "../dist/platform/daemon.js";

describe("platform daemon helpers", () => {
  test("supports macOS, Windows, and Linux", () => {
    assert.equal(isSupportedPlatform("darwin"), true);
    assert.equal(isSupportedPlatform("win32"), true);
    assert.equal(isSupportedPlatform("linux"), true);
    assert.equal(isSupportedPlatform("freebsd"), false);
  });

  test("prints human-readable platform names", () => {
    assert.equal(getPlatformName("darwin"), "macOS");
    assert.equal(getPlatformName("win32"), "Windows");
    assert.equal(getPlatformName("linux"), "Linux");
  });

  test("Windows task command quotes Node and proxy paths", () => {
    const command = buildWindowsTaskCommand(
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\node_modules\\dotmask\\dist\\proxy\\server.js",
      19000,
    );

    assert.equal(
      command,
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\node_modules\\dotmask\\dist\\proxy\\server.js" --port 19000',
    );
  });

  test("macOS launchd plist keeps configured port", () => {
    const plist = buildMacLaunchdPlist("/usr/local/bin/node", "/opt/dotmask/dist/proxy/server.js", 19000);

    assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
    assert.match(plist, /<string>\/opt\/dotmask\/dist\/proxy\/server\.js<\/string>/);
    assert.match(plist, /<string>19000<\/string>/);
  });

  test("Linux pid file parser accepts valid daemon state", () => {
    assert.deepEqual(parseLinuxPidFile('{"pid":1234,"port":18787}\n'), {
      pid: 1234,
      port: 18787,
    });
  });

  test("Linux pid file parser rejects invalid daemon state", () => {
    assert.equal(parseLinuxPidFile('{"pid":"1234","port":18787}'), null);
    assert.equal(parseLinuxPidFile('{"pid":1234,"port":99999}'), null);
    assert.equal(parseLinuxPidFile("not json"), null);
  });
});
