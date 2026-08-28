import {homedir} from "node:os"
import {join, resolve} from "node:path"

export type StorybookCdpBootstrapOutcome = "ready" | "started"

export type StorybookCdpBootstrapSeams = Readonly<{
  probe(port: number): Promise<boolean>
  bootstrap(port: number): Promise<void>
  sleep(milliseconds: number): Promise<void>
}>

/** Ensures the browser endpoint before any package-owned target operation. */
export async function ensureStorybookCdp(
  port: number,
  seams: StorybookCdpBootstrapSeams = defaultSeams(),
): Promise<StorybookCdpBootstrapOutcome> {
  assertPort(port)
  if (await seams.probe(port)) return "ready"

  await seams.bootstrap(port)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await seams.probe(port)) return "started"
    await seams.sleep(100)
  }
  throw new Error(`Chrome CDP did not become ready on 127.0.0.1:${port}`)
}

function defaultSeams(): StorybookCdpBootstrapSeams {
  return Object.freeze({
    probe: probeCdp,
    bootstrap: bootstrapCdp,
    sleep: Bun.sleep,
  })
}

async function probeCdp(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

async function bootstrapCdp(port: number): Promise<void> {
  const directory = await chromeBootstrapDirectory()
  const child = Bun.spawn([process.execPath, "run", "cdp"], {
    cwd: directory,
    env: {...Bun.env, CHROME_CDP_PORT: String(port)},
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error([
      `Chrome CDP bootstrap failed with exit code ${exitCode}`,
      stdout.trim(),
      stderr.trim(),
    ].filter(Boolean).join("\n"))
  }
}

async function chromeBootstrapDirectory(): Promise<string> {
  const configured = Bun.env.STORYBOOK_CDP_BOOTSTRAP_ROOT?.trim()
  const directory = configured
    ? resolve(configured)
    : join(homedir(), "repozitarium", "ai-macos", "chrome")
  const manifestPath = join(directory, "package.json")
  let manifest: {name?: unknown; scripts?: Record<string, unknown>}
  try {
    manifest = await Bun.file(manifestPath).json()
  } catch (error) {
    throw new Error(`Canonical Chrome CDP bootstrap is unavailable: ${manifestPath}`, {cause: error})
  }
  if (manifest.name !== "@meta/chrome" || typeof manifest.scripts?.cdp !== "string") {
    throw new Error(`Invalid canonical Chrome CDP bootstrap package: ${manifestPath}`)
  }
  return directory
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("CDP port must be an integer in 1..65535")
  }
}
