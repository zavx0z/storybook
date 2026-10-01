import createWeb from "@app/web"
import PackageArtifactsOwner from "@package/artifacts"
const collectUnpublishedStorybookArtifacts = PackageArtifactsOwner
import ServerState from "@app-server/state"
const {externalStorybookArtifactRoot, inspectExternalStorybookServer} = ServerState
import startExternalStorybookServer from "@app/server"
import {realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"
export type ExternalStorybookDaemonOptions = Readonly<{
  declarations?: readonly string[]
  port?: number
  startLease: Readonly<{path: string; token: string}>
}>

/** Runs the canonical server independently from CLI or MCP transport lifetime. */
export async function runExternalStorybookDaemon(
  options: ExternalStorybookDaemonOptions,
): Promise<void> {
  const toolRoot = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
  const implementationDigest = externalStorybookImplementationDigest(toolRoot)
  const inspection = await inspectExternalStorybookServer()
  if (inspection.state === "running") {
    throw new Error("Refusing to start a second external Storybook daemon")
  }
  if (inspection.state === "stale" && !inspection.replaceable) {
    throw new Error(`Refusing ambiguous Storybook daemon state: ${inspection.reason}`)
  }
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
      implementationDigest,
      onStartupPhase,
      declarations: options.declarations ?? Object.freeze([]),
      ...(options.port === undefined ? {} : {port: options.port}),
      startLease: options.startLease,
    })
  } catch (error) {
    if ((options.port ?? 0) === 0 || !addressInUse(error)) throw error
    running = await startExternalStorybookServer({createWeb,
      toolRoot,
      implementationDigest,
      onStartupPhase,
      declarations: options.declarations ?? Object.freeze([]),
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
