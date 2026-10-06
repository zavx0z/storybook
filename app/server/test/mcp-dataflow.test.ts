import {afterAll, beforeAll, expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Catalog from "@zavx0z/storybook-app-server-catalog"
import sources from "@zavx0z/storybook-app-knowledge-catalog"
import rest from "@zavx0z/storybook-app-knowledge"
import repo from "@zavx0z/storybook-repo-env"
import component from "@zavx0z/storybook-component-env"
import container from "@zavx0z/storybook-container-env"
import cluster from "@zavx0z/storybook-cluster-env"
import domain from "@zavx0z/storybook-domain-env"

let root: string
const reader = new Catalog()
const scenario = 'throw new Error("MCP не исполняет сценарий")\n'
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "storybook-entity-mcp-")))
  const owner = join(root, "owner")
  for (const dir of ["contract", "spec", "child"]) await mkdir(join(owner, dir), {recursive: true})
  await writeFile(join(owner, "package.json"), JSON.stringify({name: "@fixture/owner", label: "Владелец", workspaces: ["child"]}))
  await writeFile(join(owner, "index.ts"), "/** Сохранённое назначение.\n@packageDocumentation\n*/\nexport default (value: string) => value.length\n")
  await writeFile(join(owner, "contract/index.ts"), "export declare namespace Owner { type Input = string; type Output = number; interface Slots { header: string } }\n")
  await writeFile(join(owner, "spec/scenario.spec.ts"), scenario)
  await writeFile(join(owner, "child/package.json"), JSON.stringify({name: "@fixture/child", label: "Участник", description: "Назначение ребёнка."}))
  const writer = new Catalog()
  try { await writer.open({root, name: "Project"}, [owner]) } finally { await writer.dispose() }
  await reader.open({root, name: "Project"}, [owner])
  await writeFile(join(owner, "index.ts"), "/** Несохранённое изменение.\n@packageDocumentation\n*/\nexport default 0\n")
})
afterAll(async () => { await reader.dispose(); if (root) await rm(root, {recursive: true, force: true}) })

test.each([
  {type: "Repo" as const, read: repo},
  {type: "Component" as const, read: component},
  {type: "Container" as const, read: container},
  {type: "Cluster" as const, read: cluster},
  {type: "Domain" as const, read: domain},
])("PackageMetadata → проекция $type → Knowledge сохраняет содержание", async ({type, read}) => {
  const verification = {status: "confirmed" as const, type, revision: "working"}
  const entries = sources(reader.snapshot(), async () => verification)
  const selected = entries.find(entry => entry.path === "owner")!
  const direct = read({...(selected.directory === undefined ? {} : {directory: selected.directory}), sources: selected.sources})
  expect(direct.documents.input?.path).toBe(selected.sources?.input?.path)
  const expected = {
    description: "Сохранённое назначение.", path: "./owner", label: "Владелец",
    children: [{path: "./owner/child", label: "Участник", description: "Назначение ребёнка."}],
    input: {type: "string"}, output: {type: "number"},
    slots: {type: "object", properties: {header: {type: "string"}}, required: ["header"]},
    scenarios: [scenario],
  }
  const response = await rest(new Request("http://localhost", {method: "POST", body: JSON.stringify({path: "owner"})}), {projectName: "Project", entries})
  expect(response.status).toBe(200)
  const value = await response.json()
  expect(value).toEqual({...expected, verification})
  expect(reader.metrics().resolverCalls).toBe(0)
  expect(reader.metrics().typescriptApiSessions.total).toBe(0)
  expect(JSON.stringify(value)).not.toContain(root)
})
