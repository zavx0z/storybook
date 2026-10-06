import createWeb from "@zavx0z/storybook-app-web"
import PackageArtifactsOwner from "@zavx0z/storybook-package-artifacts"
const collectUnpublishedStorybookArtifacts = PackageArtifactsOwner
import ServerState from "@zavx0z/storybook-app-server-state"
const {externalStorybookArtifactRoot, inspectExternalStorybookServer} = ServerState
import startExternalStorybookServer from "@zavx0z/storybook-app-server"
import createApp, {type StorybookApp} from "../index"
import createControl from "@zavx0z/storybook-app-control"
import {realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {realpath} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import {homedir} from "node:os"
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
  let controller: StorybookApp.Output | undefined
  const control = createControl({controller: () => controller ??= createApp({toolRoot})})
  const extensions: NonNullable<Parameters<typeof startExternalStorybookServer>[0]["extensions"]> = input => input.inspectExecutors ? control.tools : []
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
      extensions,
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
      extensions,
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
Принимает явно указанный Project без поиска по Git и соседним каталогам.
Пока приложение запускает один известный Project zavx0z; локальные пути хранилищ
настраиваются в интерфейсе и сами по себе не меняют открытый проект.

@internal
*/
export async function resolveDaemonProject(
  _toolRoot: string,
  declarations: readonly string[],
): Promise<string> {
  const contexts = declarations.length === 0 ? [join(homedir(), "projects/zavx0z")] : declarations
  const roots = [...new Set(await Promise.all(contexts.map(context => {
    const path = resolve(context)
    return realpath(basename(path) === "package.json" ? dirname(path) : path)
  }))) ]
  if (roots.length !== 1) throw new Error(`Контекст запуска не определяет единственный Project: ${roots.join(", ")}`)
  return roots[0]!
}
