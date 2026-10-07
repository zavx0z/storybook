import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {providerTransport} from "../src/provider-routing"
import {createExecutionOptions} from "../src/execution-options"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

const ollama = {id: "gpu", provider: "ollama" as const, label: "Ollama GPU", enabled: true,
  endpoint: {url: "http://localhost:11434", ssh: {host: "gpu", port: 22}}}
const codex = {id: "codex", provider: "codex" as const, label: "Codex", enabled: true}

async function fixture() {
  const toolRoot = await mkdtemp(join(tmpdir(), "provider-routing-"))
  const module = join(toolRoot, "node_modules/@zavx0z/provider-app-ollama")
  await mkdir(module, {recursive: true})
  await writeFile(join(toolRoot, "package.json"), JSON.stringify({name: "fixture"}))
  await writeFile(join(module, "package.json"), JSON.stringify({name: "@zavx0z/provider-app-ollama", main: "index.ts"}))
  await writeFile(join(module, "index.ts"), "throw new Error('Probe fixture не запускает модель')\n")
  return {toolRoot, project: join(toolRoot, "project"), entry: await realpath(join(module, "index.ts")),
    dispose: () => rm(toolRoot, {recursive: true, force: true})}
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
