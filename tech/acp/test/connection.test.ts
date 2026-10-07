import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {join} from "node:path"
import {copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {pathToFileURL} from "node:url"
import {RequestError, type SessionUpdate} from "@agentclientprotocol/sdk"
import createAcp, {type StorybookTechAcp} from "../index"

const cwd = resolve(import.meta.dir, "../../..")
const fixture = resolve(import.meta.dir, "fixture/agent.ts")
const mcpServers: StorybookTechAcp.Input["mcpServers"] = [{
  name: "scope-fixture",
  command: "fixture-mcp",
  args: ["--exact"],
  env: [{name: "SCOPE", value: "/fixture/address"}],
}]

function options(overrides: Partial<StorybookTechAcp.Input> = {}): StorybookTechAcp.Input {
  return {
    cwd,
    command: process.execPath,
    args: [fixture],
    mcpServers,
    onUpdate() {},
    async onPermission() { return {outcome: {outcome: "cancelled"}} },
    ...overrides,
    env: {
      CODEX_CONFIG: undefined,
      INITIAL_AGENT_MODE: undefined,
      DISABLE_MCP_CONFIG_FILTERING: undefined,
      ...overrides.env,
    },
  }
}

function message(update: SessionUpdate): string {
  if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
    throw new Error("Ожидается исходный текстовый ACP update")
  }
  return update.content.text
}

test("SDK передаёт cwd, MCP и native config отдельному процессу; соединение живёт несколько turn", async () => {
  const updates: SessionUpdate[] = []
  const connection = await createAcp(options({
    mode: "workspace-write",
    config: {"mcp_servers.other.enabled": false},
    onUpdate(update) { updates.push(update) },
  }))
  try {
    expect(connection.sessionId).toBe("fixture-session")
    expect(await connection.prompt("first")).toEqual({stopReason: "end_turn"})
    expect(await connection.prompt("second")).toEqual({stopReason: "end_turn"})
    expect(updates.map(update => JSON.parse(message(update)))).toEqual(["first", "second"].map(text => ({
      input: {cwd, mcpServers},
      text,
      mode: "workspace-write",
      config: {"mcp_servers.other.enabled": false},
    })))
  } finally {
    await connection.dispose()
  }
  expect(connection.dispose()).toBe(connection.dispose())
  await expect(connection.prompt("closed")).rejects.toThrow("закрывается")
})

test("permission возвращает явный ответ callback без автоматического разрешения", async () => {
  const updates: SessionUpdate[] = []
  let requested = false
  const connection = await createAcp(options({
    onUpdate(update) { updates.push(update) },
    async onPermission(request) {
      requested = true
      expect(request.sessionId).toBe("fixture-session")
      return {outcome: {outcome: "selected", optionId: "deny"}}
    },
  }))
  try {
    await connection.prompt("permission")
    expect(requested).toBeTrue()
    expect(JSON.parse(message(updates[0]!))).toEqual({outcome: {outcome: "selected", optionId: "deny"}})
  } finally {
    await connection.dispose()
  }
})

test("cancel посылает session/cancel и сохраняет реальный итог prompt", async () => {
  let observed!: () => void
  const update = new Promise<void>(resolve => { observed = resolve })
  const connection = await createAcp(options({onUpdate() { observed() }}))
  try {
    const prompt = connection.prompt("wait")
    await update
    await expect(connection.prompt("parallel")).rejects.toThrow("уже выполняется")
    await connection.cancel()
    expect(await prompt).toEqual({stopReason: "cancelled"})
  } finally {
    await connection.dispose()
  }
})

test("load восстанавливает указанный ID и подавляет replay собственной истории", async () => {
  const updates: SessionUpdate[] = []
  const connection = await createAcp(options({
    previousSessionId: "retained-session",
    env: {ACP_FIXTURE_BEHAVIOR: "no-new"},
    onUpdate(update) { updates.push(update) },
  }))
  try {
    expect(connection.sessionId).toBe("retained-session")
    expect(updates).toEqual([])
    await connection.prompt("continued")
    expect(updates).toHaveLength(1)
    expect(JSON.parse(message(updates[0]!)).input.sessionId).toBe("retained-session")
  } finally {
    await connection.dispose()
  }
})

test.each([
  ["no-load", "не поддерживает восстановление"],
  ["load-error", "Сохранённая сессия отсутствует"],
  ["load-error-data", "Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу"],
  ["load-error-inline", "Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу"],
])("невозможное восстановление %s не создаёт новый контекст", async (behavior, error) => {
  await expect(createAcp(options({
    previousSessionId: "retained-session",
    env: {ACP_FIXTURE_BEHAVIOR: behavior},
  }))).rejects.toThrow(error)
})

test("отказ восстановления раскрывает понятную причину и сохраняет данные ACP", async () => {
  const error = await createAcp(options({
    previousSessionId: "retained-session",
    env: {ACP_FIXTURE_BEHAVIOR: "load-error-data"},
  })).catch(error => error)
  expect(error).toBeInstanceOf(RequestError)
  expect(error.code).toBe(-32603)
  expect(error.message).toBe("Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу")
  expect(error.message).not.toContain("codex unarchive")
  expect(error.data.details).toContain("is archived")
  expect(error.cause).toBeInstanceOf(RequestError)
  expect(error.cause.message).toBe("Internal error")
})

test("prompt и настройка сохраняют текстовые details отказа вместо одного Internal error", async () => {
  const connection = await createAcp(options({env: {ACP_FIXTURE_BEHAVIOR: "request-error-data"}}))
  try {
    await expect(connection.prompt("image")).rejects.toThrow("Изображение отклонено исполнителем")
    await expect(connection.setConfigOption("model", "model-a")).rejects.toThrow("Настройка недоступна")
  } finally {
    await connection.dispose()
  }
})

test("большие данные отказа остаются в диагностике, но не раздувают сообщение интерфейса", async () => {
  const error = await createAcp(options({previousSessionId: "retained-session", env: {ACP_FIXTURE_BEHAVIOR: "load-error-long"}})).catch(error => error)
  expect(error).toBeInstanceOf(RequestError)
  expect(error.message.length).toBe(2048)
  expect(error.message.endsWith("…")).toBe(true)
  expect(error.data.details).toBe("Причина отказа. ".repeat(1000))
  expect(error.cause).toBeInstanceOf(RequestError)
})

test("чужой session/update не попадает в историю", async () => {
  const updates: SessionUpdate[] = []
  const connection = await createAcp(options({
    env: {ACP_FIXTURE_BEHAVIOR: "foreign"},
    onUpdate(update) { updates.push(update) },
  }))
  try {
    await expect(connection.prompt("foreign")).rejects.toThrow("другой сессии")
    expect(updates).toEqual([])
  } finally {
    await connection.dispose()
  }
})

test("выход процесса не становится успешным stopReason", async () => {
  const connection = await createAcp(options())
  try {
    await expect(connection.prompt("crash")).rejects.toThrow()
    await expect(connection.prompt("after-crash")).rejects.toThrow()
  } finally {
    await connection.dispose()
  }
})

test("signal закрывает незавершённый initialize и освобождает child", async () => {
  const abort = new AbortController()
  const connection = createAcp(options({signal: abort.signal, env: {ACP_FIXTURE_BEHAVIOR: "stall"}}))
  const timer = setTimeout(() => abort.abort(new Error("Остановлено владельцем")), 50)
  try {
    await expect(connection).rejects.toThrow("Остановлено владельцем")
  } finally {
    clearTimeout(timer)
  }
})

test("dispose отклоняет ожидающий prompt вместо притворного результата", async () => {
  let observed!: () => void
  const update = new Promise<void>(resolve => { observed = resolve })
  const connection = await createAcp(options({onUpdate() { observed() }}))
  const prompt = connection.prompt("wait")
  const settled = prompt.catch(error => error)
  await update
  await connection.dispose()
  expect(await settled).toBeInstanceOf(Error)
})

test("exclusiveMcp отключает inherited/plugin MCP и сохраняет назначенный same-name override", async () => {
  const updates: SessionUpdate[] = []
  const connection = await createAcp(options({
    exclusiveMcp: true,
    mode: "workspace-write",
    config: {"mcp_servers.extra.enabled": true, "features.plugins": true},
    onUpdate(update) { updates.push(update) },
  }))
  try {
    await connection.prompt("policy")
    const state = JSON.parse(message(updates[0]!))
    expect(state.config).toEqual({
      "features.plugins": false,
      "features.apps": false,
      "mcp_servers.extra.enabled": false,
      "mcp_servers.global-fixture.enabled": false,
      "mcp_servers.scope-fixture.enabled": true,
    })
    expect(state.filtering).toBe("true")
    expect(state.input.mcpServers).toEqual(mcpServers)
    expect(JSON.stringify(state)).not.toContain("PRIVATE_VALUE_MUST_NOT_BE_RETURNED")
  } finally {
    await connection.dispose()
  }
})

test("signal останавливает policy probe до запуска ACP connection", async () => {
  const abort = new AbortController()
  const connection = createAcp(options({
    exclusiveMcp: true,
    signal: abort.signal,
    env: {ACP_FIXTURE_BEHAVIOR: "probe-stall"},
  }))
  const timer = setTimeout(() => abort.abort(new Error("Probe остановлен владельцем")), 50)
  try {
    await expect(connection).rejects.toThrow("Probe остановлен владельцем")
  } finally {
    clearTimeout(timer)
  }
})

test("самостоятельный child не наследует Desktop identity; permission profile остаётся", async () => {
  const updates: SessionUpdate[] = []
  const connection = await createAcp(options({
    env: {
      CODEX_APP_TOOLS_PIPE_PATH: "parent-private-pipe",
      CODEX_THREAD_ID: "parent-thread",
      CODEX_SESSION_ID: "parent-session",
      CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY: "parent-routing",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "parent-client",
      CODEX_PERMISSION_PROFILE: "fixture-profile",
    },
    onUpdate(update) { updates.push(update) },
  }))
  try {
    await connection.prompt("env")
    const state = JSON.parse(message(updates[0]!))
    expect(state.parentContext).toEqual([])
    expect(state.permissionProfile).toBe("fixture-profile")
    expect(process.env.CODEX_THREAD_ID).not.toBe("parent-thread")
  } finally {
    await connection.dispose()
  }
})

test("изолированный bundle разрешает default adapter в installation, отдельно от artifact cwd", async () => {
  const directory = mkdtempSync(join(tmpdir(), "storybook-acp-bundle-"))
  const installation = join(directory, "tool")
  const adapter = join(installation, "node_modules/@agentclientprotocol/codex-acp")
  const artifacts = join(directory, "artifacts")
  const native = join(installation, "node_modules/@openai/codex/bin")
  mkdirSync(adapter, {recursive: true})
  mkdirSync(native, {recursive: true})
  mkdirSync(join(installation, "tech/acp/src"), {recursive: true})
  copyFileSync(resolve(import.meta.dir, "../src/codex.ts"), join(installation, "tech/acp/src/codex.ts"))
  writeFileSync(join(native, "codex.js"), "throw new Error(\"Fake adapter не должен запускать native Codex\")\n")
  writeFileSync(join(native, "../package.json"), JSON.stringify({name: "@openai/codex", type: "module"}))
  writeFileSync(join(installation, "package.json"), JSON.stringify({name: "fixture-tool", type: "module"}))
  writeFileSync(join(adapter, "package.json"), JSON.stringify({name: "@agentclientprotocol/codex-acp", main: "index.js", type: "module"}))
  writeFileSync(join(adapter, "index.js"), `await import(${JSON.stringify(pathToFileURL(fixture).href)})\n`)
  let connection: StorybookTechAcp.Output | undefined
  try {
    const result = await Bun.build({entrypoints: [resolve(import.meta.dir, "../index.ts")], outdir: artifacts, target: "bun"})
    expect(result.success).toBeTrue()
    const bundled = await import(pathToFileURL(join(artifacts, "index.js")).href) as {default: typeof createAcp}
    const updates: SessionUpdate[] = []
    connection = await bundled.default({
      cwd,
      installation,
      exclusiveMcp: true,
      mcpServers,
      onUpdate(update) { updates.push(update) },
      async onPermission() { return {outcome: {outcome: "cancelled"}} },
    })
    await connection.prompt("bundled")
    expect(connection.sessionId).toBe("fixture-session")
    expect(JSON.parse(message(updates[0]!)).input.cwd).toBe(cwd)
  } finally {
    await connection?.dispose()
    rmSync(directory, {recursive: true, force: true})
  }
})

test("Codex launcher передаёт bootstrap overrides до app-server без собственного протокола", async () => {
  const native = resolve(import.meta.dir, "fixture/native.ts")
  const launcher = resolve(import.meta.dir, "../src/codex.ts")
  const args = ["-c", "features.plugins=false", "-c", "mcp_servers.fixture.enabled=false"]
  const child = Bun.spawn([launcher, "app-server"], {
    env: {
      ...process.env,
      STORYBOOK_ACP_NATIVE_COMMAND: process.execPath,
      STORYBOOK_ACP_NATIVE_ARGUMENTS: JSON.stringify([native, ...args]),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(exitCode).toBe(0)
  expect(stderr).toBe("")
  expect(JSON.parse(stdout)).toEqual([...args, "app-server"])
})

test("provider Codex entry сохраняет CLI probe и native bootstrap overrides установленного Codex", async () => {
  const directory = mkdtempSync(join(tmpdir(), "storybook-provider-codex-"))
  const adapter = join(directory, "node_modules/@agentclientprotocol/codex-acp")
  const composition = join(directory, "node_modules/@zavx0z/provider-app-codex")
  const native = join(directory, "node_modules/@openai/codex/bin")
  const observed = join(directory, "observed.json")
  for (const path of [adapter, composition, native, join(directory, "tech/acp/src")]) mkdirSync(path, {recursive: true})
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: "fixture-tool", type: "module"}))
  writeFileSync(join(adapter, "package.json"), JSON.stringify({name: "@agentclientprotocol/codex-acp", main: "index.js", type: "module"}))
  writeFileSync(join(adapter, "index.js"), `await import(${JSON.stringify(pathToFileURL(fixture).href)})\n`)
  writeFileSync(join(native, "codex.js"), "throw new Error('Native model должен оставаться не запущен')\n")
  writeFileSync(join(native, "../package.json"), JSON.stringify({name: "@openai/codex", type: "module"}))
  writeFileSync(join(composition, "package.json"), JSON.stringify({name: "@zavx0z/provider-app-codex", main: "index.js", type: "module"}))
  writeFileSync(join(composition, "index.js"), `
    import {writeFileSync} from "node:fs"
    if (!process.argv.includes("cli")) writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
      path: process.env.CODEX_PATH, command: process.env.STORYBOOK_ACP_NATIVE_COMMAND,
      args: JSON.parse(process.env.STORYBOOK_ACP_NATIVE_ARGUMENTS),
    }))
    await import(${JSON.stringify(pathToFileURL(fixture).href)})
  `)
  let connection: StorybookTechAcp.Output | undefined
  try {
    connection = await createAcp({cwd, installation: directory, adapter: "@zavx0z/provider-app-codex",
      exclusiveMcp: true, mcpServers: [], onUpdate() {},
      async onPermission() {return {outcome: {outcome: "cancelled"}}},
    })
    const value = JSON.parse(await Bun.file(observed).text())
    expect(value.path).toBe(join(directory, "tech/acp/src/codex.ts"))
    expect(value.command).toBe(process.execPath)
    expect(value.args[0]).toBe(join(native, "codex.js"))
    expect(value.args).toContain("features.plugins=false")
    expect(value.args).toContain("features.apps=false")
    expect(value.args).toContain("mcp_servers.global-fixture.enabled=false")
    expect(value.args).toContain("mcp_servers.scope-fixture.enabled=false")
  } finally {await connection?.dispose(); rmSync(directory, {recursive: true, force: true})}
})
