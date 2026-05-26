export function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export function getPlatformName(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return platform;
}

export function requireSupportedPlatform(commandName = "dotmask"): void {
  if (!isSupportedPlatform()) {
    throw new Error(`${commandName} supports macOS and Windows. Current platform: ${getPlatformName()}.`);
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildWindowsTaskCommand(nodePath: string, proxyPath: string, port: number): string {
  return `${quoteWindowsArg(nodePath)} ${quoteWindowsArg(proxyPath)} --port ${port}`;
}

export function buildMacLaunchdPlist(
  nodePath: string,
  proxyPath: string,
  port: number,
  options: {
    label?: string;
    caDir?: string;
    stdoutPath?: string;
    stderrPath?: string;
    debug?: string;
  } = {},
): string {
  const label = options.label ?? "com.dotmask.proxy";
  const caDir = options.caDir ?? "~/.dotmask/ca";
  const stdoutPath = options.stdoutPath ?? "~/.dotmask/proxy.log";
  const stderrPath = options.stderrPath ?? "~/.dotmask/proxy.err.log";
  const debug = options.debug ?? "0";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(proxyPath)}</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DOTMASK_CA_DIR</key>
    <string>${xmlEscape(caDir)}</string>
    <key>DOTMASK_DEBUG</key>
    <string>${xmlEscape(debug)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
`;
}
