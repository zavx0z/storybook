import {expect, test} from "bun:test"
import {resolve} from "node:path"
import discover from "@repo/discovery"
import createGraph from "@package-graph/create"
import revision from "@package/revision"
import rest from "@mcp/rest"
import resolveRoute from "@route/resolve"
import {storybookMcpEntries} from "../src/mcp-entries"
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
