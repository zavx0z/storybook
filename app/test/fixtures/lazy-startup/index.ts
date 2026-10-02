import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join, resolve} from "node:path"

/** Тот же минимальный resident layout, которым implementation-digest тестирует App identity. */
const residentTrees = [
  "app/server", "app/mcp", "app/web/build", "app/web/protocol", "app/web/release",
  "contracts", "package/activation", "package/artifacts", "package/build",
  "package/documentation", "package/graph", "package/identity", "package/index",
  "package/package-json", "package/reader", "package/resources", "package/revision",
  "package/route", "package/session", "package/standard", "repo/discovery",
  "specs/scenarios/reader", "specs/reader", "tech/build", "tech/http", "tech/limits", "tech/process",
]

export type StartupTrace = {pid: number; tool: string; status: string}

/** Подготавливает private state и trusted MCP factory; не запускает daemon или транспорт. */
export function createLazyStartupFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-lazy-startup-")))
  const toolRoot = join(root, "tool")
  const stateRoot = join(root, "state")
  const eventsRoot = join(root, "events")
  const repository = resolve(import.meta.dir, "../../../..")
  for (const directory of [toolRoot, stateRoot, eventsRoot]) mkdirSync(directory, {mode: 0o700})
  for (const tree of residentTrees) {
    mkdirSync(join(toolRoot, tree), {recursive: true})
    writeFileSync(join(toolRoot, tree, "index.ts"), `export const owner = ${JSON.stringify(tree)}\n`)
  }
  for (const path of ["bun.lock", "bunfig.toml", "package.json", "app/src/daemon-entry.ts", "app/src/daemon.ts", "app/src/implementation-digest.ts"]) {
    mkdirSync(dirname(join(toolRoot, path)), {recursive: true})
    writeFileSync(join(toolRoot, path), `export const source = ${JSON.stringify(path)}\n`)
  }
  writeFileSync(join(toolRoot, "package.json"), JSON.stringify({name: "@fixture/lazy-startup-tool", private: true, type: "module"}))
  writeFileSync(join(toolRoot, "bunfig.toml"), "[test]\npreload = []\n")
  writeFileSync(join(toolRoot, "bun.lock"), JSON.stringify({lockfileVersion: 1, workspaces: {}}))
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"))
  const daemonEntryPath = join(import.meta.dir, "daemon.ts")
  const serverModule = join(root, "factory.ts")
  writeFileSync(serverModule, `
import createApp from "@storybook/app"
import {createAppMcpServer} from ${JSON.stringify(join(repository, "app/src/mcp.ts"))}
import {appendFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"

const eventsRoot = ${JSON.stringify(eventsRoot)}

export default function factory() {
  // Bun.spawn использует startup environment; fixture задаёт private state в самом fresh worker.
  Bun.env.STORYBOOK_STATE_ROOT = ${JSON.stringify(stateRoot)}
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  process.once("exit", () => writeFileSync(join(eventsRoot, process.pid + ".exited"), "exited"))
  return createAppMcpServer({
    controller: createApp({toolRoot: ${JSON.stringify(toolRoot)}, daemonEntryPath: ${JSON.stringify(daemonEntryPath)}, legacyStatePaths: []}),
    recordRequest: async entry => {
      appendFileSync(join(eventsRoot, "requests.jsonl"), JSON.stringify({pid: process.pid, tool: entry.tool, status: entry.status}) + "\\n")
    },
  })
}
`)
  return {
    root,
    toolRoot,
    stateRoot,
    eventsRoot,
    daemonEntryPath,
    options: {serverModule, cwd: toolRoot, temporaryRoot: join(root, "jobs"), name: "cold-start-lazy-fixture", timeoutMs: 15_000},
    trace(): StartupTrace[] {
      return readFileSync(join(eventsRoot, "requests.jsonl"), "utf8").trim().split("\n")
        .filter(Boolean).map(line => JSON.parse(line) as StartupTrace)
    },
    dispose() { rmSync(root, {recursive: true, force: true}) },
  }
}
