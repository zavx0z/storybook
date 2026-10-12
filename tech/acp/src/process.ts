import {ndJsonStream} from "@agentclientprotocol/sdk"
import waitForOwnedChild from "@zavx0z/storybook-tech-process-wait"
import {spawn} from "node:child_process"
import {createRequire} from "node:module"
import {isAbsolute, join} from "node:path"
import {Readable, Writable} from "node:stream"
import {fileURLToPath} from "node:url"
import type {StorybookTechAcp} from "../contract"
import {prepareExclusiveMcp} from "./policy"

/** Подготавливает только принадлежащий вызову процесс и его стандартный ACP stream. */
export async function openProcess(
  input: StorybookTechAcp.Input,
  cwd: string,
  startupSignal: AbortSignal,
  progress: (phase: Parameters<NonNullable<StorybookTechAcp.Input["onProgress"]>>[0]) => void,
): Promise<NonNullable<StorybookTechAcp.Input["ownedStream"]>> {
  if (input.installation !== undefined && !isAbsolute(input.installation)) {
    throw new TypeError("ACP installation должен быть абсолютным корнем инструмента")
  }
  const command = input.command ?? process.execPath
  const installation = input.installation === undefined
    ? new URL("../index.ts", import.meta.url).href
    : join(input.installation, "package.json")
  const args = input.command === undefined
    ? [createRequire(installation).resolve(input.adapter ?? "@agentclientprotocol/codex-acp"), ...(input.args ?? [])]
    : [...(input.args ?? [])]
  const detached = process.platform !== "win32"
  const env = {...process.env, ...input.env}
  for (const name of [
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  ]) delete env[name]
  if (input.mode !== undefined) env.INITIAL_AGENT_MODE = input.mode
  if (input.config !== undefined) env.CODEX_CONFIG = JSON.stringify(input.config)
  const argsForEnv = () => {
    const resolved = input.argsForEnv === undefined ? args : input.argsForEnv(Object.freeze({...env}))
    if (!Array.isArray(resolved) || !resolved.every(value => typeof value === "string" && !value.includes("\0"))) {
      throw new TypeError("ACP argsForEnv должен вернуть массив строк без NUL")
    }
    return [...resolved]
  }
  if (input.exclusiveMcp === true) {
    progress("registry")
    delete env.PROVIDER_CODEX_BOOTSTRAP_ARGUMENTS
    let config = input.config
    if (config === undefined && env.CODEX_CONFIG !== undefined) {
      const inherited: unknown = JSON.parse(env.CODEX_CONFIG)
      if (inherited === null || typeof inherited !== "object" || Array.isArray(inherited)) {
        throw new TypeError("CODEX_CONFIG должен содержать JSON-объект")
      }
      config = inherited as Readonly<Record<string, unknown>>
    }
    const prepared = await prepareExclusiveMcp({
      command,
      args: argsForEnv(),
      cwd,
      env,
      signal: startupSignal,
      mcpServers: input.mcpServers,
      ...(config === undefined ? {} : {config}),
    })
    env.CODEX_CONFIG = JSON.stringify(prepared.config)
    env.DISABLE_MCP_CONFIG_FILTERING = "true"
    env.PROVIDER_CODEX_BOOTSTRAP_ARGUMENTS = JSON.stringify(prepared.bootstrapArgs)
    if (input.command === undefined && input.adapter !== "@zavx0z/provider-app-codex") {
      const adapter = createRequire(installation).resolve("@agentclientprotocol/codex-acp")
      const nativeCommand = env.CODEX_PATH ?? process.execPath
      const nativeArgs = env.CODEX_PATH === undefined
        ? [createRequire(adapter).resolve("@openai/codex/bin/codex.js")]
        : []
      env.STORYBOOK_ACP_NATIVE_COMMAND = nativeCommand
      env.STORYBOOK_ACP_NATIVE_ARGUMENTS = JSON.stringify([...nativeArgs, ...prepared.bootstrapArgs])
      env.CODEX_PATH = input.installation === undefined
        ? fileURLToPath(new URL("./codex.ts", import.meta.url))
        : join(input.installation, "tech/acp/src/codex.ts")
    }
  }
  startupSignal.throwIfAborted()
  progress("spawn")
  const child = spawn(command, argsForEnv(), {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached,
  })
  child.stderr.resume()
  let disposed = false
  let disposal: Promise<void> | null = null
  let resolveClosed!: () => void
  let rejectClosed!: (reason: Error) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  void closed.catch(() => {})
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", error => {
      rejectClosed(error)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      if (disposed) resolveClosed()
      else rejectClosed(new Error(`ACP process завершился: ${code ?? signal ?? "unknown"}`))
      resolve(code ?? -1)
    })
  })
  void exited.catch(() => {})
  return {
    stream: ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout, {strategy: {highWaterMark: 65536, size: chunk => chunk.byteLength}}) as unknown as ReadableStream<Uint8Array>,
      {maxMessageBytes: 16 * 1024 * 1024},
    ),
    closed,
    dispose() {
      if (disposal !== null) return disposal
      disposed = true
      child.stdin.end()
      disposal = (async () => {
        if (child.pid === undefined) {
          await exited
          return
        }
        await waitForOwnedChild({
          child: {
            pid: child.pid,
            exited,
            stdout: null,
            stderr: null,
            kill: signal => child.kill(signal as NodeJS.Signals | number | undefined),
          },
          signal: new AbortController().signal,
          timeoutMs: 4_000,
          label: "ACP",
          ...(detached ? {processGroup: {leaderPid: child.pid}} : {}),
        })
      })()
      return disposal
    },
  }
}
