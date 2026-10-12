import {expect, test} from "bun:test"
import {spawnSync} from "node:child_process"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {basename, join} from "node:path"
import {providerTransport, resolveProviderTransport, type OpenProviderPeer} from "../src/provider-routing"
import {createExecutionOptions} from "../src/execution-options"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import createSettings from "@zavx0z/storybook-app-settings"
import {createChatServer} from "../src/chat"

const ollama = {id: "gpu", provider: "ollama" as const, label: "Ollama GPU", enabled: true,
  endpoint: {url: "http://localhost:11434", ssh: {host: "gpu", port: 22}}}
const codex = {id: "codex", provider: "codex" as const, label: "Codex", enabled: true}
const capsule = {id: "capsule-work", provider: "capsule" as const, label: "Рабочий профиль", enabled: true,
  endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "deepseek" as const}}

async function fixture() {
  const toolRoot = await mkdtemp(join(tmpdir(), "provider-routing-"))
  const module = join(toolRoot, "node_modules/@zavx0z/provider-app-ollama")
  await mkdir(module, {recursive: true})
  await writeFile(join(toolRoot, "package.json"), JSON.stringify({name: "fixture"}))
  await writeFile(join(module, "package.json"), JSON.stringify({name: "@zavx0z/provider-app-ollama", main: "index.ts"}))
  await writeFile(join(module, "index.ts"), "throw new Error('Probe fixture не запускает модель')\n")
  const capsuleModule = join(toolRoot, "node_modules/@zavx0z/provider-app-capsule")
  await mkdir(capsuleModule, {recursive: true})
  await writeFile(join(capsuleModule, "package.json"), JSON.stringify({name: "@zavx0z/provider-app-capsule", main: "index.ts"}))
  await writeFile(join(capsuleModule, "index.ts"), "throw new Error('Probe fixture не запускает профиль')\n")
  return {toolRoot, project: join(toolRoot, "project"), entry: await realpath(join(module, "index.ts")),
    capsuleEntry: await realpath(join(capsuleModule, "index.ts")), dispose: () => rm(toolRoot, {recursive: true, force: true})}
}

test("выбранный Ollama получает собственный процесс и локальное хранилище; Codex сохраняет policy", async () => {
  const f = await fixture()
  try {
    const input = providerTransport(f, ollama)
    expect(input.command).toBe(process.execPath)
    expect(input.args).toHaveLength(1)
    expect(await realpath(input.args![0]!)).toBe(f.entry)
    expect(input.mode).toBeUndefined()
    expect(input.config).toBeUndefined()
    expect(input.exclusiveMcp).toBeUndefined()
    const config = JSON.parse(input.env!.PROVIDER_OLLAMA_CONFIG!)
    expect(config.endpoint).toEqual(ollama.endpoint)
    expect(config.directory).not.toContain(f.project)
    expect(config.directory).toContain("/.local/share/zavx0z/provider/ollama/")
    expect(config.directory).not.toContain("Caches")
    expect(JSON.parse(providerTransport(f, {...ollama, label: "Другое имя"}).env!.PROVIDER_OLLAMA_CONFIG!).directory).toBe(config.directory)
    expect(JSON.parse(providerTransport(f, {...ollama, id: "another"}).env!.PROVIDER_OLLAMA_CONFIG!).directory).not.toBe(config.directory)
    const native = providerTransport(f, codex)
    expect(native.adapter).toBe("@zavx0z/provider-app-codex")
    expect(native.installation).toBe(f.toolRoot)
    expect(native.mode).toBe("read-only")
    expect(native.exclusiveMcp).toBeTrue()
    expect(native.config?.["features.shell_tool"]).toBeFalse()
  } finally {await f.dispose()}
})

test("Capsule получает отдельный адаптер, профиль и постоянное хранилище Project и подключения", async () => {
  const f = await fixture()
  try {
    const input = providerTransport(f, capsule)
    expect(input.command).toBe(process.execPath)
    expect(input.args).toHaveLength(1)
    expect(await realpath(input.args![0]!)).toBe(f.capsuleEntry)
    expect(Object.keys(input.env!)).toEqual(["PROVIDER_CAPSULE_CONFIG"])
    const config = JSON.parse(input.env!.PROVIDER_CAPSULE_CONFIG!)
    expect(config.endpoint).toEqual(capsule.endpoint)
    expect(config.directory).toContain("/.local/share/zavx0z/provider/capsule/")
    expect(config.directory).not.toContain(f.project)
    expect(JSON.parse(providerTransport(f, {...capsule, label: "Новое имя"}).env!.PROVIDER_CAPSULE_CONFIG!).directory).toBe(config.directory)
    expect(JSON.parse(providerTransport(f, {...capsule, id: "other"}).env!.PROVIDER_CAPSULE_CONFIG!).directory).not.toBe(config.directory)
    expect(JSON.parse(providerTransport({...f, project: join(f.project, "another")}, capsule).env!.PROVIDER_CAPSULE_CONFIG!).directory).not.toBe(config.directory)
    expect(providerTransport(f, capsule).mode).toBeUndefined()
    expect(() => providerTransport(f, {...capsule, enabled: false})).toThrow("отключено")
  } finally {await f.dispose()}
})

test("Capsule через SSH исполняет тот же ACP entry и сохраняет identity каталога без shell-подстановок", async () => {
  const f = await fixture()
  try {
    const ssh = {host: "mesh-production1", user: "admin", port: 2222,
      providerRoot: "/remote/Provider ' $(touch hacked) $HOME", storageRoot: "/remote/Data ' $(touch hacked) $HOME", dockerContext: "capsule-qwen"}
    const input = providerTransport(f, {...capsule, ssh})
    expect(input.command).toBe("ssh")
    expect(input.args!.slice(0, 5)).toEqual(["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"])
    expect(input.args!.slice(-7, -1)).toEqual(["-p", "2222", "-l", "admin", "--", "mesh-production1"])
    expect(input.env).toBeUndefined()
    // Подставляем только executable bun; shell получает ровно команду, отправляемую OpenSSH.
    await writeFile(join(f.toolRoot, "bun"), `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),config:JSON.parse(process.env.PROVIDER_CAPSULE_CONFIG),context:process.env.DOCKER_CONTEXT}))\n`, {mode: 0o700})
    const shell = spawnSync("/bin/sh", ["-c", input.args!.at(-1)!], {cwd: f.toolRoot,
      env: {...process.env, PATH: `${f.toolRoot}:${process.env.PATH}`}, encoding: "utf8"})
    expect(shell.status).toBe(0)
    const result = JSON.parse(shell.stdout)
    const local = JSON.parse(providerTransport(f, capsule).env!.PROVIDER_CAPSULE_CONFIG!)
    expect(result.args).toEqual([join(ssh.providerRoot, "app/capsule/index.ts")])
    expect(result.config).toEqual({endpoint: capsule.endpoint, directory: join(ssh.storageRoot, "capsule", basename(local.directory))})
    expect(result.context).toBe("capsule-qwen")
    expect(await Bun.file(join(f.toolRoot, "hacked")).exists()).toBe(false)
    const {dockerContext, ...withoutContext} = ssh
    expect(providerTransport(f, {...capsule, ssh: withoutContext}).args!.at(-1)).not.toContain("DOCKER_CONTEXT=")
    expect(providerTransport({...f, toolRoot: "/absent/local/installation"}, {...capsule, ssh}).command).toBe("ssh")
  } finally {await f.dispose()}
})

test("probe Capsule читает возможности выбранного сервиса без запроса модели", async () => {
  const f = await fixture()
  let input: StorybookTechAcp.Input | undefined
  let prompts = 0
  const options = createExecutionOptions({...f, async connect(value) {
    input = value
    return {sessionId: "probe-capsule", capabilities: {}, configOptions: [
      {id: "model", type: "select", category: "model", name: "Модель", currentValue: "deepseek", options: [{value: "deepseek", name: "DeepSeek"}]},
    ], async setConfigOption() {return []}, async prompt() {prompts++; return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
  }})
  try {
    expect((await options.read(capsule, undefined, new AbortController().signal))?.[0]?.value).toBe("deepseek")
    expect(await realpath(input!.args![0]!)).toBe(f.capsuleEntry)
    expect(JSON.parse(input!.env!.PROVIDER_CAPSULE_CONFIG!).endpoint).toEqual(capsule.endpoint)
    expect(input?.mcpServers).toEqual([])
    expect(prompts).toBe(0)
  } finally {await options.dispose(); await f.dispose()}
})

test("probe маршрутизируется к выбранному подключению и получает модели без prompt", async () => {
  const f = await fixture()
  let input: StorybookTechAcp.Input | undefined
  let prompts = 0
  const options = createExecutionOptions({...f, async connect(value) {
    input = value
    return {sessionId: "probe-ollama", capabilities: {}, configOptions: [
      {id: "model", type: "select", category: "model", name: "Модель", currentValue: "qwen", options: [{value: "qwen", name: "Qwen"}]},
    ], async setConfigOption() {return []}, async prompt() {prompts++; return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
  }})
  try {
    const values = await options.read(ollama, undefined, new AbortController().signal)
    expect(values?.[0]?.value).toBe("qwen")
    expect(input?.args).toHaveLength(1)
    expect(await realpath(input!.args![0]!)).toBe(f.entry)
    expect(input?.mcpServers).toEqual([])
    expect(input?.mode).toBeUndefined()
    expect(prompts).toBe(0)
  } finally {await options.dispose(); await f.dispose()}
})

test("Chrome Studio через SSH использует собственный ACP entry без Docker", () => {
  const ssh = {host: "second-mac", providerRoot: "/remote/provider", storageRoot: "/remote/data"}
  const studio = {...capsule, provider: "chrome-studio" as const, ssh}
  const route = providerTransport({project: "/workspace/project", toolRoot: "/unused"}, studio)
  expect(route.command).toBe("ssh")
  const command = route.args!.at(-1)!
  expect(command).toContain("PROVIDER_CHROME_STUDIO_CONFIG=")
  expect(command).toContain("/remote/provider/app/chrome-studio/index.ts")
  expect(command).toContain("/remote/data/chrome-studio/")
  expect(command).not.toContain("DOCKER_CONTEXT")
})

test("Codex SSH разделяет cwd и явно доставляет только prepared policy env с безопасным quoting", async () => {
  const f = await fixture()
  try {
    const ssh = {host: "capsule-codespace", user: "codespace", port: 2222,
      providerRoot: join(f.toolRoot, "Provider ' $(touch hacked) $HOME"),
      storageRoot: join(f.toolRoot, "Remote Data ' $(touch hacked) $HOME")}
    const selected = {...codex, id: "codex-codespace", ssh}
    const route = providerTransport(f, selected)
    expect(route.command).toBe("ssh")
    expect(route.mode).toBe("read-only")
    expect(route.exclusiveMcp).toBeTrue()
    expect(route.config?.["features.shell_tool"]).toBeFalse()
    expect(route.agentCwd).toStartWith(join(ssh.storageRoot, "codex/"))
    expect(providerTransport(f, {...selected, label: "Новое имя"}).agentCwd).toBe(route.agentCwd)
    expect(providerTransport(f, {...selected, id: "other"}).agentCwd).not.toBe(route.agentCwd)
    expect(providerTransport({...f, project: join(f.project, "another")}, selected).agentCwd).not.toBe(route.agentCwd)
    const config = {"features.shell_tool": false, "features.plugins": false, "features.apps": false,
      "mcp_servers.remote-only.enabled": false}
    const bootstrap = ["-c", "features.plugins=false", "-c", "features.apps=false", "-c", "mcp_servers.remote-only.enabled=false"]
    const args = route.argsForEnv!({CODEX_CONFIG: JSON.stringify(config), INITIAL_AGENT_MODE: "read-only",
      DISABLE_MCP_CONFIG_FILTERING: "true", PROVIDER_CODEX_BOOTSTRAP_ARGUMENTS: JSON.stringify(bootstrap),
      CODEX_PATH: "/local-only/shim", OPENAI_API_KEY: "LOCAL_SECRET_NOT_FOR_SSH"})
    expect(args.slice(-7, -1)).toEqual(["-p", "2222", "-l", "codespace", "--", ssh.host])
    expect(args).toContain("ConnectTimeout=30")
    expect(args.at(-1)).not.toContain("LOCAL_SECRET_NOT_FOR_SSH")
    expect(args.at(-1)).not.toContain("/local-only/shim")
    await writeFile(join(f.toolRoot, "bun"), `#!${process.execPath}\nconsole.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),config:JSON.parse(process.env.CODEX_CONFIG),mode:process.env.INITIAL_AGENT_MODE,filtering:process.env.DISABLE_MCP_CONFIG_FILTERING,bootstrap:JSON.parse(process.env.PROVIDER_CODEX_BOOTSTRAP_ARGUMENTS)}))\n`, {mode: 0o700})
    const shell = spawnSync("/bin/sh", ["-c", args.at(-1)!], {cwd: f.toolRoot,
      env: {...process.env, PATH: `${f.toolRoot}:${process.env.PATH}`}, encoding: "utf8"})
    expect(shell.status).toBe(0)
    expect(JSON.parse(shell.stdout)).toEqual({cwd: await realpath(route.agentCwd!),
      args: [join(ssh.providerRoot, "app/codex/index.ts")], config, mode: "read-only", filtering: "true", bootstrap})
    expect(await Bun.file(join(f.toolRoot, "hacked")).exists()).toBeFalse()
    expect(providerTransport({...f, toolRoot: "/absent/local/installation"}, selected).command).toBe("ssh")
  } finally {await f.dispose()}
})

test("Codex remote model probe сохраняет локальный cwd Project и отдельный native agentCwd без prompt", async () => {
  const f = await fixture()
  let input: StorybookTechAcp.Input | undefined
  let prompts = 0
  const selected = {...codex, id: "codex-codespace", ssh: {host: "capsule-codespace", providerRoot: "/workspaces/provider", storageRoot: "/workspaces/private"}}
  const options = createExecutionOptions({...f, async connect(value) {
    input = value
    return {sessionId: "remote-probe", capabilities: {}, configOptions: [], async setConfigOption() {return []},
      async prompt() {prompts++; return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
  }})
  try {
    await options.read(selected, undefined, new AbortController().signal)
    expect(input!.cwd).toBe(f.project)
    expect(input!.agentCwd).toBe(providerTransport(f, selected).agentCwd)
    expect(input!.agentCwd).toStartWith("/workspaces/private/codex/")
    expect(input!.mcpServers).toEqual([])
    expect(prompts).toBe(0)
  } finally {await options.dispose(); await f.dispose()}
})

test("peer routing passes exact assignment and resume IDs without process options for every provider", async () => {
  const peer = {peerId: "codespace", executorId: "configured-executor"}
  const ownedStream: NonNullable<StorybookTechAcp.Input["ownedStream"]> = {
    stream: {readable: new ReadableStream(), writable: new WritableStream()}, closed: new Promise(() => {}), async dispose() {},
  }
  const opened: Parameters<OpenProviderPeer>[0][] = []
  const signal = new AbortController().signal
  const options = {project: "/project", toolRoot: "/absent-no-native-resolution", async openPeer(input: Parameters<OpenProviderPeer>[0]) {
    opened.push(input)
    return ownedStream
  }}
  const {ssh: _ssh, ...ollamaEndpoint} = ollama.endpoint
  const selected = [{...codex, peer}, {...ollama, endpoint: ollamaEndpoint, peer}, {...capsule, peer}, {...capsule, provider: "chrome-studio" as const, peer}]
  for (const connection of selected) {
    expect(await resolveProviderTransport(options, connection, {assignmentId: "worker-1", previousSessionId: "native-existing", signal})).toEqual({ownedStream})
    expect(opened.at(-1)).toEqual({connectionId: connection.id, ...peer, assignmentId: "worker-1", previousSessionId: "native-existing", signal})
  }
})

test("peer routing never falls back without a configured factory or on factory failure", async () => {
  const selected = {...codex, peer: {peerId: "codespace", executorId: "configured-executor"}}
  const options = {project: "/project", toolRoot: "/absent"}
  const context = {assignmentId: "worker", signal: new AbortController().signal}
  await expect(resolveProviderTransport(options, selected, context)).rejects.toThrow("не настроен хостом")
  expect(() => providerTransport(options, selected)).toThrow("resolveProviderTransport")
  const failure = new Error("peer unavailable")
  let count = 0
  const result = await resolveProviderTransport({...options, async openPeer() {
    count++
    throw failure
  }}, selected, context).catch(error => error)
  expect(result).toBe(failure)
  expect(count).toBe(1)
})

test("disabled, ambiguous and invalid peer routes are rejected before opening", async () => {
  const selected = {...codex, peer: {peerId: "codespace", executorId: "configured-executor"}}
  let opened = 0
  const options = {project: "/project", toolRoot: "/absent", async openPeer(): Promise<NonNullable<StorybookTechAcp.Input["ownedStream"]>> {
    opened++
    throw new Error("must not open")
  }}
  const context = {assignmentId: "worker", signal: new AbortController().signal}
  await expect(resolveProviderTransport(options, {...selected, enabled: false}, context)).rejects.toThrow("отключено")
  await expect(resolveProviderTransport(options, {...selected, ssh: {host: "remote", providerRoot: "/provider", storageRoot: "/storage"}}, context)).rejects.toThrow("Peer и SSH")
  await expect(resolveProviderTransport(options, {...ollama, peer: selected.peer}, context)).rejects.toThrow("Peer и SSH")
  await expect(resolveProviderTransport(options, {...selected, peer: {...selected.peer, peerId: "../remote"}}, context)).rejects.toThrow("identity")
  expect(opened).toBe(0)
})

test("aborted peer opening releases a late owned stream before returning it", async () => {
  const controller = new AbortController()
  let disposed = 0
  const result = resolveProviderTransport({project: "/project", toolRoot: "/absent", async openPeer() {
    controller.abort()
    return {stream: {readable: new ReadableStream(), writable: new WritableStream()}, closed: new Promise<void>(() => {}), async dispose() {disposed++}}
  }}, {...codex, peer: {peerId: "remote", executorId: "configured"}}, {assignmentId: "worker", signal: controller.signal})
  await expect(result).rejects.toThrow()
  expect(disposed).toBe(1)
})

test("chat peer route preserves environment assignment and native identity after reopening", async () => {
  const project = await mkdtemp(join(tmpdir(), "peer-chat-route-"))
  const opened: Parameters<OpenProviderPeer>[0][] = []
  const acp: StorybookTechAcp.Input[] = []
  const settings = createSettings({project})
  const connection = {...codex, id: "stable-connection", peer: {peerId: "remote-host", executorId: "remote-codex"}}
  const serverOptions = {
    project, projectName: () => "Project", toolRoot: project,
    graph: () => ({nodes: []} as unknown as StorybookPackageGraphRead.Input), entries: () => [],
    async openPeer(input: Parameters<OpenProviderPeer>[0]) {
      opened.push(input)
      return {stream: {readable: new ReadableStream(), writable: new WritableStream()}, closed: new Promise<void>(() => {}), async dispose() {}}
    },
    async connect(input: StorybookTechAcp.Input): Promise<StorybookTechAcp.Output> {
      acp.push(input)
      return {sessionId: input.previousSessionId ?? "native-existing", capabilities: {}, configOptions: [],
        async setConfigOption() {return []}, async prompt() {return {stopReason: "end_turn"}}, async cancel() {},
        async dispose() {await input.ownedStream?.dispose()},
      }
    },
  }
  let server = createChatServer(serverOptions)
  try {
    await settings.update({...await settings.read(), connections: [connection], general: {connectionId: connection.id}})
    const prepared = await server.chats.prepare("/")
    expect(opened[0]?.assignmentId).toBe(prepared.executorId)
    expect(opened[0]?.connectionId).toBe(connection.id)
    expect(acp[0]?.cwd).toBe(project)
    expect(acp[0]?.ownedStream).toBeDefined()
    expect(acp[0]?.command).toBeUndefined()
    expect(acp[0]?.exclusiveMcp).toBeUndefined()
    await server.chats.prompt("/", "first turn", "request-one")
    const completed = Promise.withResolvers<void>()
    const unsubscribe = await server.chats.subscribe("/", snapshot => {
      if (snapshot.status === "idle" && snapshot.pending.length === 0) completed.resolve()
    })
    await completed.promise
    unsubscribe()
    await server.dispose()
    server = createChatServer(serverOptions)
    const restored = await server.chats.prepare("/")
    expect(opened.at(-1)?.assignmentId).toBe(prepared.executorId)
    expect(opened.at(-1)?.previousSessionId).toBe("native-existing")
    expect(restored.execution?.pinnedConnectionId).toBe(connection.id)
    expect(acp.at(-1)?.previousSessionId).toBe("native-existing")
  } finally {
    await server.dispose()
    await rm(project, {recursive: true, force: true})
  }
})
