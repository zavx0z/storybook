import {readFileSync} from "node:fs"
import {
  buildStorybookPackageRevisionInProcess,
  type StorybookPackageBuildWorkerJob,
  type StorybookPackageBuildWorkerResult,
} from "./package-build.ts"

const controller = new AbortController()
const abort = (): void => controller.abort(new DOMException("Storybook package build worker terminated", "AbortError"))
process.once("SIGTERM", abort)
process.once("SIGINT", abort)

await main().finally(() => {
  process.off("SIGTERM", abort)
  process.off("SIGINT", abort)
})

async function main(): Promise<void> {
  const [jobPath, resultPath] = process.argv.slice(2)
  if (jobPath === undefined || resultPath === undefined) {
    process.stderr.write("Storybook package build worker requires job and result paths\n")
    process.exitCode = 2
    return
  }
  let result: StorybookPackageBuildWorkerResult
  try {
    const job = JSON.parse(readFileSync(jobPath, "utf8")) as StorybookPackageBuildWorkerJob
    const build = await buildStorybookPackageRevisionInProcess({
      ...job.input,
      signal: controller.signal,
    }, job.options)
    result = Object.freeze({ok: true, build})
  } catch (error) {
    result = Object.freeze({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: diagnosticsFromError(error),
    })
    process.exitCode = 1
  }
  await Bun.write(resultPath, `${JSON.stringify(result)}\n`)
}

function diagnosticsFromError(
  error: unknown,
): readonly Readonly<{phase: string, message: string, path: string | null}>[] {
  if (!(error instanceof Error)) {
    return Object.freeze([{phase: "compile", message: String(error), path: null}])
  }
  const diagnostics = (error as Error & {storybookDiagnostics?: unknown}).storybookDiagnostics
  if (Array.isArray(diagnostics)) {
    const safe = diagnostics.flatMap((diagnostic) => {
      if (diagnostic === null || typeof diagnostic !== "object") return []
      const value = diagnostic as Record<string, unknown>
      if (typeof value.phase !== "string" || typeof value.message !== "string" ||
        (value.path !== null && typeof value.path !== "string")) return []
      return [Object.freeze({phase: value.phase, message: value.message, path: value.path as string | null})]
    })
    if (safe.length > 0) return Object.freeze(safe)
  }
  return Object.freeze([{
    phase: error.name === "TimeoutError" ? "timeout" : "compile",
    message: error.message,
    path: null,
  }])
}
