import {expect, test} from "bun:test"
import {spatialPackages} from "../src/spatial-catalog"
import type {ExternalStorybookClientSnapshot} from "../src/types"

type Node = ExternalStorybookClientSnapshot["nodes"][number]
const node = (id: string, kind: Node["kind"], parentId: string | null): Node => ({
  id, kind, parentId, label: id, ownerId: id,
  packageId: kind === "package" ? id : null,
  childIds: [], urlPath: `/${id}/`, routePath: "", searchTerms: [], resourceUrl: "",
})

test("пространство содержит только пакеты и сохраняет ближайших пакетных предков", () => {
  // Порядок снимка не обязан быть обходом родителей перед детьми.
  const nodes = [
    node("child", "package", "nested"),
    node("repo", "package", null),
    node("group", "directory", "repo"),
    node("nested", "directory", "group"),
    node("entry", "entry", "repo"),
    node("missing", "unavailable", null),
    node("sibling", "package", "nested"),
    node("other", "package", null),
  ]
  expect(spatialPackages({nodes}).map(({node, parentId}) => [node.id, parentId])).toEqual([
    ["child", "repo"], ["repo", null], ["sibling", "repo"], ["other", null],
  ])
  expect(nodes[0]!.parentId).toBe("nested")
  expect(spatialPackages({nodes: []})).toEqual([])
})
