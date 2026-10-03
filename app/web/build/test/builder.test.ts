import {afterEach, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Scheduler from "@package-build/scheduler"
import {runSharedBrowserBuild} from "../src/builder"

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
    `console.log(JSON.stringify({protocol: ${JSON.stringify(Scheduler.STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL)}, kind: "ready", workerId, pid: process.pid}))`,
    'process.stderr.write("compiler warning\\n".repeat(10_000))',
    'writeFileSync(resultPath, JSON.stringify({error: "exact compilation failure"}))',
    'process.exitCode = 1',
  ].join("\n"))
  const scheduler = new Scheduler()
  try {
    await expect(scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, context =>
      runSharedBrowserBuild({root: join(root, "assets"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: ""}, context, 2_000, join(root, "build/shared-browser-worker.ts")),
    new AbortController().signal)).rejects.toThrow("exact compilation failure")
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
  const scheduler = new Scheduler()
  try {
    await expect(scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, context =>
      runSharedBrowserBuild({root: join(root, "assets"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: ""}, context, 2_000, join(root, "build/shared-browser-worker.ts")),
    new AbortController().signal)).rejects.toThrow("output reader failed")
    expect(scheduler.snapshot().recent[0]?.outcome).toBe("failed")
    expect(readdirSync(root)).toEqual(["build"])
  } finally { scheduler.dispose() }
})


test.each([
  {name: "результат больше прежнего 1 МиБ", paddingBytes: 2 * 1024 * 1024, message: "structured worker failure"},
  {name: "результат сверх 8 МиБ", paddingBytes: 8 * 1024 * 1024, message: "result exceeds limit"},
])("shared result: $name", async ({paddingBytes, message}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-shared-worker-size-")))
  roots.push(root)
  mkdirSync(join(root, "build"))
  writeFileSync(join(root, "build/shared-browser-worker.ts"), [
    'import {writeFileSync} from "node:fs"',
    'const [, resultPath, workerId] = process.argv.slice(2)',
    `console.log(JSON.stringify({protocol: ${JSON.stringify(Scheduler.STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL)}, kind: "ready", workerId, pid: process.pid}))`,
    `writeFileSync(resultPath, JSON.stringify({error: "structured worker failure", padding: "x".repeat(${paddingBytes})}))`,
    'process.exitCode = 1',
  ].join("\n"))
  const scheduler = new Scheduler()
  try {
    await expect(scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, context =>
      runSharedBrowserBuild({root: join(root, "assets"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: ""}, context, 2_000, join(root, "build/shared-browser-worker.ts")),
    new AbortController().signal)).rejects.toThrow(message)
    expect(scheduler.snapshot().recent[0]?.outcome).toBe("failed")
    expect(readdirSync(root)).toEqual(["build"])
  } finally { scheduler.dispose() }
})
