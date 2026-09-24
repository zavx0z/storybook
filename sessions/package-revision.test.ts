import {describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
  validateStorybookPackageRevisionGraphSnapshot,
} from "./package-revision.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const graph = async () => createExternalStorybookGraph(await discoverStorybookPackages([fixtureRoot]))

describe("structural package revision graph", () => {
  test("projects one browser-safe package graph with physical ancestors and routes", async () => {
    const snapshot = createStorybookPackageRevisionGraphSnapshot(await graph(), "@fixture/components", "components")
    expect(validateStorybookPackageRevisionGraphSnapshot(snapshot, "@fixture/components")).toBe(snapshot)
    expect(snapshot.rootId).toBe("package:@fixture/components")
    expect(snapshot.ancestors.map(ancestor => [ancestor.id, ancestor.parentId])).toEqual([
      ["package:fixture-workspace", null],
      ["directory:package:fixture-workspace/projects", "package:fixture-workspace"],
      ["package:fixture-alpha", "directory:package:fixture-workspace/projects"],
      ["directory:package:fixture-alpha/packages", "package:fixture-alpha"],
    ])
    expect(snapshot.nodes.map(node => node.id)).toEqual([
      "package:@fixture/components",
      "directory:package:@fixture/components/docs",
    ])
    expect(snapshot.routes.map(route => route.path)).toEqual(["", "dir-docs"])
    expect(snapshot.resources.some(resource => resource.nodeId === snapshot.rootId && resource.kind === "readme")).toBeTrue()
    expect(JSON.stringify(snapshot)).not.toContain(fixtureRoot)
    expect(snapshot.packageGraphDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  test("retains Workbench theme as its own revision collection", async () => {
    const snapshot = createStorybookPackageRevisionGraphSnapshot(await graph(), "@fixture/components", "components", [{
      specifier: "@zavx0z/ui/themes/theme.css", path: "/owner/theme.css", ownerRoot: "/owner",
      ownerPackageJsonPath: "/owner/package.json", contentDigest: "a".repeat(64),
    }])
    expect(snapshot.workbenchAuthorStyleSheets).toEqual([{
      specifier: "@zavx0z/ui/themes/theme.css", url: "workbench-author-style-sheets/0.css", contentDigest: "a".repeat(64),
    }])
    expect(validateStorybookPackageRevisionGraphSnapshot(snapshot)).toBe(snapshot)
  })

  test("rejects mutated metadata, foreign package identity and old protocol", async () => {
    const snapshot = createStorybookPackageRevisionGraphSnapshot(await graph(), "@fixture/components", "components")
    expect(() => validateStorybookPackageRevisionGraphSnapshot({...snapshot, metadata: {...snapshot.metadata, label: "changed"}})).toThrow("digest mismatch")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(snapshot, "@fixture/other")).toThrow("identity mismatch")
    expect(() => validateStorybookPackageRevisionGraphSnapshot({...snapshot, protocol: "storybook-package-graph/1"} as never)).toThrow("Unsupported Storybook package graph protocol")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(redigest({...snapshot,
      ancestors: [snapshot.ancestors[1]!, snapshot.ancestors[0]!, ...snapshot.ancestors.slice(2)],
    }))).toThrow("ancestor sequence is invalid")
  })

  test("rejects broken structural links and routes even with a matching digest", async () => {
    const snapshot = createStorybookPackageRevisionGraphSnapshot(await graph(), "@fixture/components", "components")
    const [root, directory] = snapshot.nodes
    expect(() => validateStorybookPackageRevisionGraphSnapshot(redigest({...snapshot,
      nodes: [root!, {...directory!, parentId: "package:missing"}],
    }))).toThrow("child is invalid")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(redigest({...snapshot,
      routes: [...snapshot.routes, snapshot.routes[0]!],
    }))).toThrow("route is invalid")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(redigest({...snapshot,
      workbenchAuthorStyleSheets: [{specifier: "@zavx0z/ui/themes/theme.css", url: "theme.css", contentDigest: "a".repeat(64)}],
    }))).toThrow("Workbench stylesheet is invalid")
  })
})

function redigest(value: StorybookPackageRevisionGraphSnapshot): StorybookPackageRevisionGraphSnapshot {
  const {packageGraphDigest: _previous, ...withoutDigest} = value
  return {...withoutDigest, packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex")}
}
