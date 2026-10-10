/**
Открывает долгоживущую ACP-сессию через официальный SDK и установленный Codex
адаптер. Транспорт владеет своим процессом, но не историей, адресами и решениями
о полномочиях. Каждое разрешение передаётся вызывающему владельцу.

@packageDocumentation
*/
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type SessionNotification,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk"
import waitForOwnedChild from "@zavx0z/storybook-tech-process-wait"
import {spawn} from "node:child_process"
import {realpath, stat} from "node:fs/promises"
import {createRequire} from "node:module"
import {isAbsolute, join} from "node:path"
import {Readable, Writable} from "node:stream"
import {fileURLToPath} from "node:url"
import type {StorybookTechAcp} from "./contract"
import {prepareExclusiveMcp} from "./src/policy"
import {promptContent} from "./src/content"
import {gatedInput, notificationFlow} from "./src/flow"

export type {StorybookTechAcp} from "./contract"

/** Штатная причина отказа ACP остаётся читаемой для владельца сессии. */
function requestFailure(error: unknown): never {
  if (error instanceof RequestError) {
    const data: unknown = error.data
    const details = typeof data === "string" ? data
      : data !== null && typeof data === "object" && "details" in data && typeof data.details === "string"
        ? data.details : undefined
    const reason = details?.trim()
    const archived = /^session [a-f0-9-]+ is archived\b/iu.test(reason ?? error.message)
    const message = archived ? "Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу"
      : reason && !error.message.includes(reason) ? `${error.message}: ${reason}` : error.message
    const visible = message.length > 2048 ? `${message.slice(0, 2047)}…` : message
    if (visible !== error.message) {
      const failure = new RequestError(error.code, visible, error.data)
      failure.cause = error
      throw failure
    }
  }
  throw error
}

/**
Инициализирует ACP и создаёт либо восстанавливает точную сессию.
Время жизни подготовки и исполнения принадлежит вызывающему владельцу через signal.
Credentials наследуются дочерним процессом; транспорт не читает их содержимое.
Конфигурацию sandbox и MCP обеспечивает вызывающий владелец через штатный
environment адаптера. Сам cwd не является sandbox.

@param input - Каталог, предоставленные серверы и callbacks согласно {@link StorybookTechAcp.Input}.
@returns Готовая сессия; после использования требуется вызвать dispose.
@throws Ошибка запуска, initialize, восстановления, открытия сессии или callback.
Ошибка восстановления не заменяется созданием нового контекста.
Текст причины из ACP error data раскрывается в сообщении ошибки; code и data сохраняются.
Архивированная сессия Codex сообщает человеку причину и действие для продолжения беседы.

@example
```ts
const connection = await createAcp({
  cwd: "/workspace/project/component",
  mcpServers: [],
  onUpdate: update => history.append(update),
  onPermission: request => permissions.ask(request),
})
try {
  await connection.prompt("Объясни публичный контракт")
} finally {
  await connection.dispose()
}
```
*/
export default async function createAcp(input: StorybookTechAcp.Input): Promise<StorybookTechAcp.Output> {
  input.signal?.throwIfAborted()
  if (!isAbsolute(input.cwd)) throw new TypeError("ACP cwd должен быть абсолютным каталогом")
  const cwd = await realpath(input.cwd)
  if (!(await stat(cwd)).isDirectory()) throw new TypeError("ACP cwd должен быть каталогом")
  if (input.agentCwd !== undefined && (!isAbsolute(input.agentCwd) || input.agentCwd.length > 4096 || /[\u0000-\u001f\u007f]/u.test(input.agentCwd))) {
    throw new TypeError("ACP agentCwd должен быть абсолютным путём без управляющих символов")
  }
  const agentCwd = input.agentCwd ?? cwd
  if (input.previousSessionId !== undefined && !input.previousSessionId.trim()) {
    throw new TypeError("Восстанавливаемый ACP sessionId не может быть пустым")
  }
  if (input.installation !== undefined && !isAbsolute(input.installation)) {
    throw new TypeError("ACP installation должен быть абсолютным корнем инструмента")
  }
  const command = input.command ?? process.execPath
  const installation = input.installation === undefined
    ? import.meta.url
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
  const startupSignal = input.signal ?? new AbortController().signal
  const progress = (phase: Parameters<NonNullable<StorybookTechAcp.Input["onProgress"]>>[0]): void => {
    try { input.onProgress?.(phase) } catch { /* Наблюдатель не меняет выполнение. */ }
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
        ? fileURLToPath(new URL("./src/codex.ts", import.meta.url))
        : join(input.installation, "tech/acp/src/codex.ts")
    }
  }
  startupSignal.throwIfAborted()
  input.signal?.throwIfAborted()
  progress("spawn")
  const child = spawn(command, argsForEnv(), {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached,
  })
  child.stderr.resume()
  let failure: Error | null = null
  let disposed = false
  let disposal: Promise<void> | null = null
  let sessionId: string | null = input.previousSessionId ?? null
  let replay = input.previousSessionId !== undefined
  let configOptions: readonly SessionConfigOption[] = []
  let prompting = false
  let notifications = Promise.resolve()
  const flow = notificationFlow()
  const early: SessionNotification[] = []
  const connection = client({name: "storybook"})
    .onRequest(methods.client.session.requestPermission, async ({params, signal}) => {
      assertOpen()
      if (params.sessionId !== sessionId) throw new Error("ACP permission принадлежит другой сессии")
      const response = await input.onPermission(params, signal)
      const outcome = response.outcome
      if (outcome.outcome === "selected" &&
        !params.options.some(option => option.optionId === outcome.optionId)) {
        throw new Error("Выбрано отсутствующее ACP permission optionId")
      }
      return response
    })
    .onNotification(methods.client.session.update, ({params}) => {
      if (disposed) return
      if (sessionId === null) {
        if (early.length >= 32 || Buffer.byteLength(JSON.stringify([...early, params])) > 16 * 1024 * 1024) {
          fail(new Error("ACP прислал слишком много updates до identity сессии"))
          return
        }
        early.push(params)
        return
      }
      enqueue(params, replay)
    })
    .connect(ndJsonStream(
      Writable.toWeb(child.stdin),
      gatedInput(Readable.toWeb(child.stdout, {strategy: {highWaterMark: 65536, size: chunk => chunk.byteLength}}) as unknown as ReadableStream<Uint8Array>, () => flow.wait()),
      {maxMessageBytes: 16 * 1024 * 1024},
    ))

  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", error => {
      fail(error)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      if (!disposed) fail(new Error(`ACP process завершился: ${code ?? signal ?? "unknown"}`))
      resolve(code ?? -1)
    })
  })
  void exited.catch(() => {})

  function fail(error: unknown): void {
    failure ??= error instanceof Error ? error : new Error(String(error))
    flow.close()
    connection.close(failure)
  }

  function assertOpen(): void {
    if (disposed) throw new Error("ACP connection уже закрывается")
    if (failure !== null) throw failure
    if (connection.signal.aborted) throw new Error("ACP transport закрыт")
  }

  function enqueue(notification: SessionNotification, fromReplay = false): void {
    let release: () => void
    try { release = flow.reserve(Buffer.byteLength(JSON.stringify(notification))) }
    catch (error) { fail(error); return }
    notifications = notifications.then(async () => {
      if (notification.sessionId !== sessionId) throw new Error("ACP update принадлежит другой сессии")
      if (notification.update.sessionUpdate === "config_option_update") configOptions = notification.update.configOptions
      if (fromReplay) {
        if (input.onReplay !== undefined) await input.onReplay(notification.update)
        else if (["config_option_update", "usage_update"].includes(notification.update.sessionUpdate)) await input.onUpdate(notification.update)
      } else await input.onUpdate(notification.update)
    }).finally(release).catch(error => {
      fail(error)
      throw error
    })
    void notifications.catch(() => {})
  }

  function dispose(): Promise<void> {
    if (disposal !== null) return disposal
    disposed = true
    flow.close()
    input.signal?.removeEventListener("abort", onAbort)
    connection.close(new Error("ACP connection освобождён владельцем"))
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
      await connection.closed
    })()
    return disposal
  }

  function onAbort(): void {
    fail(input.signal?.reason ?? new DOMException("Aborted", "AbortError"))
    void dispose().catch(error => { failure ??= error instanceof Error ? error : new Error(String(error)) })
  }
  input.signal?.addEventListener("abort", onAbort, {once: true})
  if (input.signal?.aborted) onAbort()

  const abortStartup = () => fail(startupSignal.reason)
  startupSignal.addEventListener("abort", abortStartup, {once: true})
  try {
    progress("initialize")
    const initialized = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {name: "storybook", version: "0.0.0"},
    }, {cancellationSignal: startupSignal})
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`ACP protocol ${initialized.protocolVersion} не поддерживается`)
    }
    progress("session")
    if (input.previousSessionId !== undefined) {
      const resume = input.preferResume === true && initialized.agentCapabilities?.sessionCapabilities?.resume != null
      if (!resume && initialized.agentCapabilities?.loadSession !== true) {
        throw new Error("ACP agent не поддерживает восстановление session/load")
      }
      const session = await connection.agent.request(resume ? methods.agent.session.resume : methods.agent.session.load, {
        sessionId: input.previousSessionId,
        cwd: agentCwd,
        mcpServers: input.mcpServers,
      }, {cancellationSignal: startupSignal})
      configOptions = session.configOptions ?? []
      replay = false
    } else {
      const session = await connection.agent.request(methods.agent.session.new, {
        cwd: agentCwd,
        mcpServers: input.mcpServers,
      }, {cancellationSignal: startupSignal})
      sessionId = session.sessionId
      configOptions = session.configOptions ?? []
      for (const notification of early.splice(0)) enqueue(notification)
    }
    await notifications
    assertOpen()
    progress("ready")
    const activeSessionId = sessionId!
    return Object.freeze({
      sessionId: activeSessionId,
      capabilities: structuredClone(initialized.agentCapabilities ?? {}),
      get configOptions() { return structuredClone(configOptions) },
      async setConfigOption(configId: string, value: string) {
        assertOpen()
        if (prompting) throw new Error("Настройки нельзя менять во время ответа")
        const response = await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: activeSessionId, configId, value,
        }).catch(requestFailure)
        await notifications
        assertOpen()
        configOptions = response.configOptions
        return structuredClone(configOptions)
      },
      async prompt(content: Parameters<StorybookTechAcp.Output["prompt"]>[0]) {
        assertOpen()
        const blocks = promptContent(content, initialized.agentCapabilities ?? {})
        if (prompting) throw new Error("ACP prompt этой сессии уже выполняется")
        prompting = true
        try {
          const response = await connection.agent.request(methods.agent.session.prompt, {
            sessionId: activeSessionId,
            prompt: blocks,
          }).catch(requestFailure)
          await notifications
          assertOpen()
          return response
        } finally {
          prompting = false
        }
      },
      async cancel() {
        assertOpen()
        await connection.agent.notify(methods.agent.session.cancel, {sessionId: activeSessionId})
      },
      dispose,
    })
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "ACP startup и освобождение процесса завершились ошибкой")
    }
    requestFailure(error)
  } finally {
    startupSignal.removeEventListener("abort", abortStartup)
  }
}
