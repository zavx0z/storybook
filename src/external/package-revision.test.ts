import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {createExternalStorybookGraph} from "./graph.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  validateStorybookPackageRevisionGraphSnapshot,
} from "./package-revision.ts"

const fixtureRoot = join(import.meta.dir, "fixtures", "valid")

describe("exact Storybook package revision graph", () => {
  test("projects one browser-safe package graph with exact routes, loaders and resources", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([fixtureRoot]))
    const snapshot = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "declaration-components",
    )
    expect(validateStorybookPackageRevisionGraphSnapshot(snapshot, "@fixture/components")).toBe(snapshot)
    expect(snapshot.rootId).toBe("package:@fixture/components")
    expect(snapshot.routes.map(({path}) => path)).toEqual([
      "",
      "foundation",
      "foundation/event-target",
      "components",
      "components/button",
      "components/button/basic/contained",
      "components/button/outlined",
    ])
    expect(snapshot.loaders.map(({route}) => route)).toEqual([
      "components/button/basic/contained",
      "components/button/outlined",
    ])
    expect(JSON.stringify(snapshot)).not.toContain(fixtureRoot)
    expect(snapshot.packageGraphDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  test("rejects mutation and foreign package identity", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
      fixtureRoot,
      join(fixtureRoot, "standalone"),
    ]))
    const snapshot = createStorybookPackageRevisionGraphSnapshot(graph, "@fixture/standalone", "standalone")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(
      {...snapshot, metadata: {...snapshot.metadata, label: "mutated"}},
    )).toThrow("digest mismatch")
    expect(() => validateStorybookPackageRevisionGraphSnapshot(snapshot, "@fixture/components"))
      .toThrow("identity mismatch")
  })
})
