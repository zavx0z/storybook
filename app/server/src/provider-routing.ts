import {createHash} from "node:crypto"
import {createRequire} from "node:module"
import {homedir} from "node:os"
import {join, posix, resolve} from "node:path"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

/** Общая политика внутренних исполнителей применяется и к чтению возможностей. */
export const internalCodexPolicy = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.multi_agent": false,
  "features.hooks": false,
  "skills.include_instructions": false,
  project_doc_max_bytes: 0,
  web_search: "disabled",
}

type Resolution = NonNullable<Awaited<ReturnType<NonNullable<StorybookChatSession.Input["resolveExecution"]>>>>
type Connection = Resolution["connections"][number]

/**
Доверенный consumer предоставляет ready ACP stream для точного подключения.
Все поля локальны вызову factory; handshake отправляет только разрешённые
identity, а путь, endpoint, command и env остаются у удалённого executor host.
*/
export type OpenProviderPeer = (input: Readonly<{
  connectionId: string
  peerId: string
  executorId: string
  assignmentId: string
  previousSessionId?: string
  signal: AbortSignal
}>) => Promise<NonNullable<StorybookTechAcp.Input["ownedStream"]>>

/** Точное назначение и native identity приходят от сохраняемой сессии, а не из каталога соединений. */
export type ProviderPeerContext = Readonly<{assignmentId: string, previousSessionId?: string, signal: AbortSignal}>

/**
Открывает явно выбранный peer transport либо использует прежний process route.
Peer отказ не заменяется локальным запуском или SSH. Factory вызывается только
после проверки route, а получает отмену, assignment и прежнюю native identity.
*/
export async function resolveProviderTransport(
  options: {project: string, toolRoot: string, openPeer?: OpenProviderPeer},
  connection: Connection,
  context: ProviderPeerContext,
): Promise<Partial<StorybookTechAcp.Input>> {
  context.signal.throwIfAborted()
  if (!connection.enabled) throw new Error("Подключение недоступно или отключено")
  if (connection.peer === undefined) return providerTransport(options, connection)
  const validId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)
  if (!validId(connection.peer.peerId) || !validId(connection.peer.executorId) || !validId(context.assignmentId)) throw new TypeError("Недопустимая identity peer назначения")
  if ("ssh" in connection && connection.ssh !== undefined || connection.provider === "ollama" && connection.endpoint.ssh !== undefined) throw new TypeError("Peer и SSH не могут использоваться в одном подключении")
  if (!options.openPeer) throw new Error("Peer transport не настроен хостом для выбранного подключения")
  const ownedStream = await options.openPeer({connectionId: connection.id, ...connection.peer, assignmentId: context.assignmentId,
    ...(context.previousSessionId === undefined ? {} : {previousSessionId: context.previousSessionId}), signal: context.signal})
  if (context.signal.aborted) {
    await ownedStream.dispose()
    context.signal.throwIfAborted()
  }
  return {ownedStream}
}

/** Выбирает native процесс; SSH доставляет тот же ACP entry и явный env. Каталог процесса локален, agentCwd принадлежит машине агента. */
export function providerTransport(options: {project: string, toolRoot: string}, connection: Connection): Partial<StorybookTechAcp.Input> {
  if (!connection.enabled) throw new Error("Подключение недоступно или отключено")
  if (connection.peer !== undefined) throw new Error("Peer transport требует resolveProviderTransport и явный openPeer хоста")
  const identity = createHash("sha256").update(JSON.stringify([resolve(options.project), connection.id])).digest("hex")
  if (connection.provider === "codex" && connection.ssh) {
    const ssh = connection.ssh
    const agentCwd = posix.join(ssh.storageRoot, "codex", identity)
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const argsForEnv: NonNullable<StorybookTechAcp.Input["argsForEnv"]> = env => {
      const forwarded = ["CODEX_CONFIG", "INITIAL_AGENT_MODE", "DISABLE_MCP_CONFIG_FILTERING", "PROVIDER_CODEX_BOOTSTRAP_ARGUMENTS"]
        .flatMap(name => env[name] === undefined ? [] : [quote(`${name}=${env[name]}`)])
      const remote = `umask 077; mkdir -p ${quote(agentCwd)} && cd ${quote(agentCwd)} && exec env ${forwarded.join(" ")} bun ${quote(posix.join(ssh.providerRoot, "app/codex/index.ts"))}`
      return ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=30",
        "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
        ...(ssh.port === undefined ? [] : ["-p", String(ssh.port)]),
        ...(ssh.user === undefined ? [] : ["-l", ssh.user]), "--", ssh.host, remote]
    }
    return {
      command: "ssh", agentCwd, argsForEnv,
      args: argsForEnv({INITIAL_AGENT_MODE: "read-only", CODEX_CONFIG: JSON.stringify(internalCodexPolicy)}),
      mode: "read-only", exclusiveMcp: true, config: internalCodexPolicy,
    }
  }
  if (connection.provider === "codex") return {
    installation: options.toolRoot, adapter: "@zavx0z/provider-app-codex", mode: "read-only", exclusiveMcp: true, config: internalCodexPolicy,
  }
  const provider = connection.provider
  if ((connection.provider === "capsule" || connection.provider === "chrome-studio") && connection.ssh) {
    const ssh = connection.ssh
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const config = JSON.stringify({endpoint: connection.endpoint, directory: join(ssh.storageRoot, provider, identity)})
    const configVariable = provider === "capsule" ? "PROVIDER_CAPSULE_CONFIG" : "PROVIDER_CHROME_STUDIO_CONFIG"
    const dockerContext = connection.provider === "capsule" ? connection.ssh?.dockerContext : undefined
    const remote = `exec env ${quote(`${configVariable}=${config}`)}${dockerContext === undefined ? "" : ` ${quote(`DOCKER_CONTEXT=${dockerContext}`)}`} bun ${quote(join(ssh.providerRoot, `app/${provider}/index.ts`))}`
    return {
      command: "ssh",
      args: ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=30",
        "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
        ...(ssh.port === undefined ? [] : ["-p", String(ssh.port)]),
        ...(ssh.user === undefined ? [] : ["-l", ssh.user]), "--", ssh.host, remote],
    }
  }
  const entry = createRequire(join(options.toolRoot, "package.json")).resolve(`@zavx0z/provider-app-${provider}`)
  return {
    command: process.execPath,
    args: [entry],
    env: {[provider === "capsule" ? "PROVIDER_CAPSULE_CONFIG" : provider === "chrome-studio" ? "PROVIDER_CHROME_STUDIO_CONFIG" : "PROVIDER_OLLAMA_CONFIG"]: JSON.stringify({endpoint: connection.endpoint,
      directory: join(homedir(), ".local/share/zavx0z/provider", provider, identity)})},
  }
}
