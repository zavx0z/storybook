import {rmSync} from "node:fs"
import {startExternalStorybookServer} from "./server.ts"
import {
  externalStorybookArtifactRoot,
  inspectExternalStorybookServer,
} from "./server-state.ts"

export type ExternalStorybookDaemonOptions = Readonly<{
  declarations?: readonly string[]
  port?: number
  startLease: Readonly<{path: string; token: string}>
}>

/** Runs the canonical server independently from CLI or MCP transport lifetime. */
export async function runExternalStorybookDaemon(
  options: ExternalStorybookDaemonOptions,
): Promise<void> {
  const inspection = await inspectExternalStorybookServer()
  if (inspection.state === "running") {
    throw new Error("Refusing to start a second external Storybook daemon")
  }
  if (inspection.state === "stale" && !inspection.replaceable) {
    throw new Error(`Refusing ambiguous Storybook daemon state: ${inspection.reason}`)
  }
  rmSync(externalStorybookArtifactRoot(), {recursive: true, force: true})
  let running: Awaited<ReturnType<typeof startExternalStorybookServer>>
  try {
    running = await startExternalStorybookServer({
      declarations: options.declarations ?? Object.freeze([]),
      ...(options.port === undefined ? {} : {port: options.port}),
      startLease: options.startLease,
    })
  } catch (error) {
    if ((options.port ?? 0) === 0 || !addressInUse(error)) throw error
    running = await startExternalStorybookServer({
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
