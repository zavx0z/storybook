import {expect, test} from "bun:test"
import {join, resolve} from "node:path"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {createChatServer} from "../src/chat"
import discover from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"
import revision from "@zavx0z/storybook-package-revision"
import rest from "@zavx0z/storybook-app-knowledge"
import resolveRoute from "@zavx0z/storybook-package-route-resolve"
import storybookMcpEntries from "@zavx0z/storybook-package-mcp-source"
import {resolveStorybookRoute} from "../src/route"

test("MCP и сериализованная ревизия сохраняют оба средовых протокола без смешения", async () => {
  const root = resolve(import.meta.dir, "../../../domain/spec/fixture/domain")
  const catalog = await discover([root])
  const graph = createGraph(catalog)
  const entries = storybookMcpEntries({catalog, graph})
  const web = entries.find(entry => entry.path.endsWith("/web.ts"))!
  const server = entries.find(entry => entry.path.endsWith("/server.ts"))!
  const read = async (path: string) => {
    const response = await rest(new Request("http://localhost", {method: "POST", body: JSON.stringify({path})}), {projectName: "Fixture", entries})
    expect(response.status).toBe(200)
    return response.json()
  }
  const webDocument = await read(web.path)
  const serverDocument = await read(server.path)
  expect(webDocument.input.properties).toHaveProperty("prefix")
  expect(webDocument.input.properties).not.toHaveProperty("step")
  expect(serverDocument.input.properties).toHaveProperty("step")
  expect(serverDocument.input.properties).not.toHaveProperty("prefix")
  expect(webDocument.output.type).toBe("string")
  expect(serverDocument.output.properties.value.type).toBe("number")
  const snapshot = revision.create(graph, "@fixture/archetype-domain", "fixture")
  expect(revision.validate(JSON.parse(JSON.stringify(snapshot))).nodes.filter(node => node.kind === "entry")).toHaveLength(2)
  expect(JSON.stringify(snapshot)).not.toContain(root)
  expect(JSON.stringify(webDocument)).not.toContain(root)
  expect(await resolveRoute({route: `${web.path}?view=contract`, roots: [{name: "archetype-domain", path: root}]}))
    .toMatchObject({entry: resolve(root, "web.ts"), view: "contract"})
  expect(await resolveRoute({route: "/archetype-domain/contract/web.ts", roots: [{name: "archetype-domain", path: root}]})).toBeNull()
  expect(await resolveStorybookRoute(`${web.path}?view=contract`, {catalog, graph}))
    .toMatchObject({packageId: "@fixture/archetype-domain", route: "entry-web.ts/contract"})
})


test("чат средового входа сохраняет адрес файла и рабочий каталог владельца", async () => {
  const root = resolve(import.meta.dir, "../../../domain/spec/fixture/domain")
  const project = await mkdtemp(join(tmpdir(), "environment-entry-chat-"))
  const catalog = await discover([root])
  const graph = createGraph(catalog)
  const entry = graph.nodes.find(node => node.kind === "entry" && node.source.path.endsWith("/web.ts"))!
  const cwd: string[] = []
  const server = createChatServer({
    project, projectName: () => "Fixture", toolRoot: project,
    graph: () => graph, entries: () => storybookMcpEntries({catalog, graph}),
    async connect(input) {
      cwd.push(input.cwd)
      return {sessionId: "entry-session", capabilities: {}, configOptions: [], async setConfigOption() {return []},
        async prompt() {return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
    },
  })
  try {
    const state = await server.chats.prepare(entry.urlPath)
    expect(state.address).toBe(entry.urlPath)
    expect(cwd, "ACP получает директорию Domain, а не путь web.ts вместо cwd").toEqual([root])
  } finally {
    await server.dispose()
    await rm(project, {recursive: true, force: true})
  }
})
