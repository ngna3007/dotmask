# Windows And macOS Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dotmask install, status, doctor, and secret mapping work on macOS and Windows.

**Architecture:** Keep proxy logic platform-neutral. Move OS behavior behind small platform modules for secure storage, CA trust, and daemon startup. macOS keeps Keychain, `security`, and `launchctl`; Windows uses DPAPI through PowerShell, `certutil -user`, and Task Scheduler.

**Tech Stack:** Node.js 18+, TypeScript, Node test runner, macOS command-line tools, Windows PowerShell/certutil/schtasks.

---

### Task 1: Platform Storage

**Files:**
- Create: `src/platform/storage.ts`
- Modify: `src/proxy/masker.ts`
- Test: `test/platform.test.js`

- [x] Write tests proving non-macOS storage does not call macOS `security` and supports round-trip map lookup.
- [x] Implement storage provider selection by `process.platform`.
- [x] Replace direct Keychain calls in `masker.ts` with storage provider calls.
- [x] Run `npm test`.

### Task 2: Platform Certificate And Daemon

**Files:**
- Create: `src/platform/daemon.ts`
- Modify: `src/proxy/cert.ts`
- Modify: `src/proxy/daemon.ts`
- Modify: `src/commands/install.ts`
- Test: `test/platform.test.js`

- [x] Write tests for supported platforms and Windows command construction.
- [x] Add Windows certificate trust using `certutil -user -addstore Root`.
- [x] Add Windows startup using `schtasks /Create /SC ONLOGON`.
- [x] Preserve macOS launchd behavior.
- [x] Run `npm test`.

### Task 3: CLI And Docs

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/utils.ts`
- Modify: `README.md`
- Modify: `package.json`
- Test: `test/install.test.js`

- [x] Write tests proving invalid port validation happens before platform checks.
- [x] Replace macOS-only gate with `darwin` and `win32` support check.
- [x] Update help text, README, description, keywords.
- [x] Run `npm run build` and `npm test`.
