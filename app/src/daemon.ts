import createWeb from "@zavx0z/storybook-app-web"
import PackageArtifactsOwner from "@zavx0z/storybook-package-artifacts"
const collectUnpublishedStorybookArtifacts = PackageArtifactsOwner
import ServerState from "@zavx0z/storybook-app-server-state"
const {externalStorybookArtifactRoot, inspectExternalStorybookServer} = ServerState
import startExternalStorybookServer from "@zavx0z/storybook-app-server"
import {realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {realpath} from "node:fs/promises"
import {basename, dirname, resolve} from "node:path"
import {relocateAppChats, relocatedAppAddress} from "./layout-relocations"
export type ExternalStorybookDaemonOptions = Readonly<{
  declarations?: readonly string[]
  port?: number
  startLease: Readonly<{path: string; token: string}>
}>

/** Запускает сервер одного Project независимо от жизненного цикла MCP transport. */
export async function runExternalStorybookDaemon(
  options: ExternalStorybookDaemonOptions,
): Promise<void> {
  const toolRoot = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
  const inspection = await inspectExternalStorybookServer()
  if (inspection.state === "running") {
    throw new Error("Refusing to start a second external Storybook daemon")
  }
  if (inspection.state === "stale" && !inspection.replaceable) {
    throw new Error(`Refusing ambiguous Storybook daemon state: ${inspection.reason}`)
  }
  const project = await resolveDaemonProject(toolRoot, options.declarations ?? [])
  console.error("Storybook startup: artifacts")
  collectUnpublishedStorybookArtifacts(externalStorybookArtifactRoot())
  /** Передаёт этап запуска в диагностический поток родительского controller. */
  const onStartupPhase = (phase: string): void => {
    console.error(`Storybook startup: ${phase}`)
  }
  let running: Awaited<ReturnType<typeof startExternalStorybookServer>>
  try {
    running = await startExternalStorybookServer({createWeb,
      toolRoot,
      onStartupPhase,
      project,
      migrateChats: (chats, graph) => relocateAppChats(toolRoot, graph, chats),
      previousAddress: (pathname, graph) => relocatedAppAddress(toolRoot, graph, pathname),
      ...(options.port === undefined ? {} : {port: options.port}),
      startLease: options.startLease,
    })
  } catch (error) {
    if ((options.port ?? 0) === 0 || !addressInUse(error)) throw error
    running = await startExternalStorybookServer({createWeb,
      toolRoot,
      onStartupPhase,
      project,
      migrateChats: (chats, graph) => relocateAppChats(toolRoot, graph, chats),
      previousAddress: (pathname, graph) => relocatedAppAddress(toolRoot, graph, pathname),
      port: 0,
      startLease: options.startLease,
    })
  }
  let stopping: Promise<void> | null = null
  const stop = (): void => {
    stopping ??= Promise.resolve(running.stop()).then(() => running.stopped)
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  await running.stopped
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
  await stopping
}

function addressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE" ||
    (error instanceof Error && error.message.includes("EADDRINUSE"))
}

/**
Определяет один Project по Git-контексту прежнего launcher.
Аргументы Repo выбирают только корень Project; его состав читает Server из .gitmodules.
При пустом контексте используется Git-граница установленного инструмента.

@internal
*/
export async function resolveDaemonProject(
  toolRoot: string,
  declarations: readonly string[],
): Promise<string> {
  const contexts = declarations.length === 0 ? [toolRoot] : declarations
  const candidates = await Promise.all(contexts.map(async context => {
    const path = resolve(context)
    const directory = basename(path) === "package.json" ? dirname(path) : path
    const root = await realpath(directory)
    const superproject = await gitRoot(root, "--show-superproject-working-tree")
    const project = superproject === "" ? await gitRoot(root, "--show-toplevel") : superproject
    if (project === "") throw new Error(`Git не определил корень Project для ${root}`)
    return realpath(project)
  }))
  const roots = [...new Set(candidates)]
  if (roots.length !== 1) {
    throw new Error(`Контекст запуска не определяет единственный Project: ${roots.join(", ")}`)
  }
  return roots[0]!
}

async function gitRoot(root: string, option: string): Promise<string> {
  const child = Bun.spawn(["git", "-C", root, "rev-parse", option], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (status !== 0) throw new Error(`Не удалось определить Project для ${root}: ${error.trim()}`)
  return output.replace(/\r?\n$/u, "")
}
