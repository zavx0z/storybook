import {createHash} from "node:crypto"
import {createRequire} from "node:module"
import {homedir} from "node:os"
import {join, resolve} from "node:path"
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

/** Выбирает native процесс; история Ollama и Capsule хранится в постоянном `~/.local/share/zavx0z/provider/`, отдельно для провайдера, Project и подключения. */
export function providerTransport(options: {project: string, toolRoot: string}, connection: Connection): Partial<StorybookTechAcp.Input> {
  if (!connection.enabled) throw new Error("Подключение недоступно или отключено")
  if (connection.provider === "codex") return {
    installation: options.toolRoot, adapter: "@zavx0z/provider-app-codex", mode: "read-only", exclusiveMcp: true, config: internalCodexPolicy,
  }
  const provider = connection.provider
  const entry = createRequire(join(options.toolRoot, "package.json")).resolve(`@zavx0z/provider-app-${provider}`)
  const identity = createHash("sha256").update(JSON.stringify([resolve(options.project), connection.id])).digest("hex")
  return {
    command: process.execPath,
    args: [entry],
    env: {[provider === "capsule" ? "PROVIDER_CAPSULE_CONFIG" : "PROVIDER_OLLAMA_CONFIG"]: JSON.stringify({endpoint: connection.endpoint,
      directory: join(homedir(), ".local/share/zavx0z/provider", provider, identity)})},
  }
}
