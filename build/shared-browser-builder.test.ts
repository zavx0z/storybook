import {afterEach, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {StorybookBuildScheduler} from "./build-scheduler"
import {runSharedBrowserBuild} from "./shared-browser-builder"
import {STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL} from "./build-phase"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

test("причина отказа shared worker сохраняется после переполнения stderr предупреждениями", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-shared-worker-error-")))
  roots.push(root)
  mkdirSync(join(root, "build"))
  writeFileSync(join(root, "build/shared-browser-worker.ts"), [
    'import {writeFileSync} from "node:fs"',
    'const [, resultPath, workerId] = process.argv.slice(2)',
    `console.log(JSON.stringify({protocol: ${JSON.stringify(STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL)}, kind: "ready", workerId, pid: process.pid}))`,
    'process.stderr.write("compiler warning\\n".repeat(10_000))',
    'writeFileSync(resultPath, JSON.stringify({error: "exact input attestation failure"}))',
    'process.exitCode = 1',
  ].join("\n"))
  const scheduler = new StorybookBuildScheduler()
  try {
    await expect(scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, context =>
      runSharedBrowserBuild({root: join(root, "assets"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: ""}, context, 2_000),
    new AbortController().signal)).rejects.toThrow("exact input attestation failure")
    expect(scheduler.snapshot().recent[0]?.outcome).toBe("failed")
    expect(readdirSync(root)).toEqual(["build"])
  } finally { scheduler.dispose() }
})


test("shared adapter отклоняет посторонний stdout и очищает workspace", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-shared-worker-stream-")))
  roots.push(root)
  mkdirSync(join(root, "build"))
  writeFileSync(join(root, "build/shared-browser-worker.ts"), [
    'console.log("unrelated stdout")',
    'setInterval(() => {}, 1000)',
  ].join("\n"))
  const scheduler = new StorybookBuildScheduler()
  try {
    await expect(scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, context =>
      runSharedBrowserBuild({root: join(root, "assets"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: ""}, context, 2_000),
    new AbortController().signal)).rejects.toThrow("output reader failed")
    expect(scheduler.snapshot().recent[0]?.outcome).toBe("failed")
    expect(readdirSync(root)).toEqual(["build"])
  } finally { scheduler.dispose() }
})
