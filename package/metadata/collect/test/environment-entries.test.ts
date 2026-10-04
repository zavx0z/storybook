import {expect, test} from "bun:test"
import {resolve} from "node:path"
import discover from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"

test("два публичных входа без index сохраняют свои документы, роли и условия", async () => {
  const root = resolve(import.meta.dir, "../../../../domain/spec/fixture/domain")
  const catalog = await discover([root])
  const scope = catalog.scopes[0]!
  if (scope.kind !== "package") throw new Error("Ожидается пакет Domain")
  expect(scope.moduleDocumentation).toBeUndefined()
  expect(scope.entries?.map(entry => [entry.relativePath, entry.conditions])).toEqual([
    ["web.ts", [["browser"]]],
    ["server.ts", [["node"]]],
  ])
  expect(scope.entries?.every(entry => entry.moduleDocumentation?.markdown && entry.contractDocumentation?.documents.length === 2)).toBeTrue()
  expect(scope.entries?.map(entry => entry.contractDocumentation?.documents[0]?.sourcePath))
    .toEqual([resolve(root, "contract/web.ts"), resolve(root, "contract/server.ts")])
  const graph = createGraph(catalog)
  expect(graph.nodes.filter(node => node.kind === "entry").map(node => [node.urlPath, node.contractRoutePath])).toEqual([
    ["/archetype-domain/web.ts", "entry-web.ts/contract"],
    ["/archetype-domain/server.ts", "entry-server.ts/contract"],
  ])
})
