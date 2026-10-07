import {expect, test} from "bun:test"
import {spawnSync} from "node:child_process"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {basename, join} from "node:path"
import {providerTransport} from "../src/provider-routing"
import {createExecutionOptions} from "../src/execution-options"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

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
