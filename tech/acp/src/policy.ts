import waitForOwnedChild from "@storybook-tech-process/wait"
import {spawn} from "node:child_process"
import {Readable} from "node:stream"
import type {StorybookTechAcp} from "../contract"

type Probe = Readonly<{
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  mcpServers: StorybookTechAcp.Input["mcpServers"]
  config?: StorybookTechAcp.Input["config"]
}>

/** Содержимое CLI-ответа остаётся внутри probe; наружу выходят только config overrides. */
export async function prepareExclusiveMcp(input: Probe): Promise<Readonly<{
  config: Readonly<Record<string, unknown>>
  bootstrapArgs: readonly string[]
}>> {
  input.signal.throwIfAborted()
  const detached = process.platform !== "win32"
  const child = spawn(input.command, [...input.args, "cli", "-c", "features.plugins=false", "mcp", "list", "--json"], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? -1))
  })
  if (child.pid === undefined) {
    await exited
    throw new Error("Не удалось запустить native MCP registry probe")
  }
  const result = await waitForOwnedChild({
    child: {
      pid: child.pid,
      exited,
      stdout: Readable.toWeb(child.stdout),
      stderr: Readable.toWeb(child.stderr),
      kill: signal => child.kill(signal as NodeJS.Signals | number | undefined),
    },
    signal: input.signal,
    outputLimit: 8 * 1024 * 1024,
    label: "ACP MCP registry probe",
    ...(detached ? {processGroup: {leaderPid: child.pid}} : {}),
  })
  if (result.exitCode !== 0) throw new Error(`Native MCP registry probe завершился с кодом ${result.exitCode}`)
  let listed: unknown
  try {
    listed = JSON.parse(result.stdout)
  } catch {
    throw new Error("Native MCP registry probe не вернул JSON список")
  }
  if (!Array.isArray(listed)) throw new Error("Native MCP registry probe не вернул список серверов")
  const names = new Set<string>()
  for (const item of listed) {
    if (item === null || typeof item !== "object" || typeof item.name !== "string") {
      throw new Error("Native MCP registry probe содержит запись без имени")
    }
    names.add(exactName(item.name))
  }
  const bootstrapArgs = ["-c", "features.plugins=false", "-c", "features.apps=false"]
  for (const name of names) bootstrapArgs.push("-c", `mcp_servers.${name}.enabled=false`)
  const config = {...input.config}
  const nested = config.mcp_servers
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    for (const name of Object.keys(nested)) names.add(exactName(name))
  }
  for (const key of Object.keys(config)) {
    const match = /^mcp_servers\.([^.]+)(?:\.|$)/u.exec(key)
    if (match) names.add(exactName(match[1]!))
  }
  const assigned = new Set(input.mcpServers.map(server => exactName(server.name.replace(/\p{White_Space}/gu, "_"))))
  for (const name of assigned) names.add(name)
  config["features.plugins"] = false
  config["features.apps"] = false
  for (const name of names) config[`mcp_servers.${name}.enabled`] = assigned.has(name)
  return Object.freeze({config: Object.freeze(config), bootstrapArgs: Object.freeze(bootstrapArgs)})
}

function exactName(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(name)) {
    throw new Error("MCP server name не поддерживает однозначный native dotted override")
  }
  return name
}
