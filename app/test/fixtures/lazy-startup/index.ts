import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"

export type StartupTrace = {pid: number, operation: string, status: string}

/** Подготавливает private state и fresh callers публичного App; не запускает daemon или Web. */
export function createLazyStartupFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-lazy-startup-")))
  const toolRoot = join(root, "tool")
  const stateRoot = join(root, "state")
  const eventsRoot = join(root, "events")
  const repository = resolve(import.meta.dir, "../../../..")
  for (const directory of [toolRoot, stateRoot, eventsRoot]) mkdirSync(directory, {mode: 0o700})
  writeFileSync(join(toolRoot, "package.json"), JSON.stringify({name: "@fixture/lazy-startup-tool", private: true, type: "module"}))
  writeFileSync(join(toolRoot, "bunfig.toml"), "[test]\npreload = []\n")
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"))
  const daemonEntryPath = join(import.meta.dir, "daemon.ts")
  const requestEntryPath = join(root, "request.ts")
  writeFileSync(requestEntryPath, `
import createApp from "@zavx0z/storybook-app"
import {appendFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
const operation = process.argv[2]
const argumentsValue = JSON.parse(process.argv[3] ?? "{}")
const app = createApp({toolRoot: ${JSON.stringify(toolRoot)}, daemonEntryPath: ${JSON.stringify(daemonEntryPath)}, legacyStatePaths: []})
process.once("exit", () => writeFileSync(join(${JSON.stringify(eventsRoot)}, process.pid + ".exited"), "exited"))
try {
  if (operation !== "status" && operation !== "ensure") throw new Error("Unexpected fixture operation")
  const result = await app[operation](argumentsValue, {signal: AbortSignal.timeout(10_000)})
  appendFileSync(join(${JSON.stringify(eventsRoot)}, "requests.jsonl"), JSON.stringify({pid: process.pid, operation, status: result.status}) + "\\n")
  console.log(JSON.stringify(result))
} catch (error) {
  appendFileSync(join(${JSON.stringify(eventsRoot)}, "requests.jsonl"), JSON.stringify({pid: process.pid, operation, status: "failed"}) + "\\n")
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
`)
  return {
    root, toolRoot, stateRoot, eventsRoot, daemonEntryPath, requestEntryPath,
    async request(operation: "status" | "ensure", input: Record<string, unknown> = {schemaVersion: 1}): Promise<Record<string, unknown>> {
      const caller = Bun.spawn([process.execPath, requestEntryPath, operation, JSON.stringify(input)], {
        cwd: toolRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 15_000,
        env: {...Bun.env, BUN_FEATURE_FLAG_NO_ORPHANS: "0", STORYBOOK_STATE_ROOT: stateRoot, STORYBOOK_LAZY_STARTUP_FIXTURE: "isolated"},
      })
      const [exitCode, stdout, stderr] = await Promise.all([caller.exited, new Response(caller.stdout).text(), new Response(caller.stderr).text()])
      if (exitCode !== 0 || caller.signalCode !== null) throw new Error(`Fixture App caller failed: ${stderr}`)
      return JSON.parse(stdout.trim()) as Record<string, unknown>
    },
    trace(): StartupTrace[] {
      return readFileSync(join(eventsRoot, "requests.jsonl"), "utf8").trim().split("\n")
        .filter(Boolean).map(line => JSON.parse(line) as StartupTrace)
    },
    dispose() { rmSync(root, {recursive: true, force: true}) },
  }
}
