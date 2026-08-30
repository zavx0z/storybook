import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {ExternalStorybookRegistry} from "./registry.ts"
import {externalStorybookStructuralWatchPaths} from "./server.ts"

const fixtureRoot = join(import.meta.dir, "fixtures", "valid")
const storybookRoot = join(import.meta.dir, "..", "..")

describe("external Storybook attached-root registry", () => {
  test("atomically attaches workspace and independent package without a fake workspace", async () => {
    const registry = new ExternalStorybookRegistry()
    await registry.attach(fixtureRoot)
    const snapshot = await registry.attach(join(fixtureRoot, "standalone"))
    expect(snapshot.entries.map(({canonicalId}) => canonicalId)).toEqual([
      "workspace:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(snapshot.graph.rootIds).toEqual(snapshot.entries.map(({canonicalId}) => canonicalId))
    expect(snapshot.entries[0]?.descendantIds).toContain("package:@fixture/components")
    expect(snapshot.entries[1]?.rootKind).toBe("package")
  })

  test("keeps the current graph untouched when a new root fails validation", async () => {
    const registry = new ExternalStorybookRegistry()
    const before = await registry.attach(fixtureRoot)
    await expect(registry.attach(join(fixtureRoot, "missing"))).rejects.toThrow()
    const after = registry.snapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.graph).toBe(before.graph)
    expect(after.entries).toBe(before.entries)
  })

  test("detaches only the selected subtree and leaves the server registry usable", async () => {
    const registry = new ExternalStorybookRegistry()
    await registry.attachMany([fixtureRoot, join(fixtureRoot, "standalone")])
    const detached = await registry.detach("fixture-workspace")
    expect(detached.entries.map(({canonicalId}) => canonicalId)).toEqual([
      "package:@fixture/standalone",
    ])
    expect(detached.graph.nodes.some(({id}) => id === "package:@fixture/components")).toBeFalse()
    expect(detached.graph.nodes.some(({id}) => id === "package:@fixture/standalone")).toBeTrue()
  })

  test("derives independent package build descriptors from graph owners", async () => {
    const registry = new ExternalStorybookRegistry()
    await registry.attach(fixtureRoot)
    const descriptors = registry.packageDescriptors()
    const components = descriptors.find(({packageId}) => packageId === "@fixture/components")!
    expect(components.projectRoot).toEndWith("/projects/alpha")
    expect(components.packageRoot).toEndWith("/projects/alpha/packages/components")
    expect(components.runtime?.export).toBe("runtime")
    expect(components.variants.map(({route}) => route)).toEqual([
      "components/button/basic/contained",
      "components/button/outlined",
    ])
    expect(components.declarationDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/docs/architecture.svg"),
      category: "resource",
    })
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/tokens.css"),
      category: "resource",
    })
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/theme.css"),
      category: "resource",
    })
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/.storybook/runtime.ts"),
      category: "code",
    })
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/.storybook/stories/button.ts"),
      category: "code",
    })
    expect(components.watchPaths).toContainEqual({
      path: join(fixtureRoot, "projects/alpha/packages/components/.storybook/widgets/fixture-controls.tsx"),
      category: "code",
    })
    expect(components.widgetModules).toEqual([{
      id: "fixture-controls",
      module: {
        path: join(fixtureRoot, "projects/alpha/packages/components/.storybook/widgets/fixture-controls.tsx"),
        export: "FixtureControlsWidget",
      },
    }])
    expect(components.graphSnapshot.widgetLoaders).toEqual([{
      id: "fixture-controls",
      exportName: "FixtureControlsWidget",
    }])
    expect(components.resourceFiles?.filter(({targetPath}) => targetPath.startsWith("author-style-sheets/")))
      .toEqual([
        {
          sourcePath: join(fixtureRoot, "projects/alpha/packages/components/tokens.css"),
          sourceRoot: join(fixtureRoot, "projects/alpha/packages/components"),
          targetPath: "author-style-sheets/0.css",
          contentDigest: components.graphSnapshot.authorStyleSheets[0]!.contentDigest,
        },
        {
          sourcePath: join(fixtureRoot, "projects/alpha/packages/components/theme.css"),
          sourceRoot: join(fixtureRoot, "projects/alpha/packages/components"),
          targetPath: "author-style-sheets/1.css",
          contentDigest: components.graphSnapshot.authorStyleSheets[1]!.contentDigest,
        },
      ])
    expect(components.resourceFiles?.find(({sourcePath}) => sourcePath.endsWith("/docs/architecture.svg"))?.targetPath)
      .toEndWith("/docs/architecture.svg")
    const structural = externalStorybookStructuralWatchPaths(registry.snapshot())
    expect(structural).toContain(join(fixtureRoot, "README.md"))
    expect(structural).toContain(join(fixtureRoot, "projects/alpha/README.md"))
    expect(structural).toContain(join(fixtureRoot, "projects/alpha/packages/components/tokens.css"))
    expect(structural).toContain(join(fixtureRoot, "projects/alpha/packages/components/theme.css"))
  })

  test("copies and watches Workbench author sheets separately for every package revision", async () => {
    const registry = new ExternalStorybookRegistry()
    await registry.attachMany([storybookRoot, fixtureRoot])
    const components = registry.packageDescriptors()
      .find(({packageId}) => packageId === "@fixture/components")!
    expect(components.graphSnapshot.workbenchAuthorStyleSheets.map(({specifier, url}) => ({specifier, url})))
      .toEqual([{
        specifier: "@ui/components/theme.css",
        url: "workbench-author-style-sheets/0.css",
      }])
    const workbenchResource = components.resourceFiles?.find(({targetPath}) =>
      targetPath === "workbench-author-style-sheets/0.css")
    expect(workbenchResource).toMatchObject({
      contentDigest: components.graphSnapshot.workbenchAuthorStyleSheets[0]!.contentDigest,
    })
    expect(workbenchResource?.sourcePath).toEndWith("/packages/components/theme.css")
    expect(components.watchPaths).toContainEqual({
      path: workbenchResource!.sourcePath,
      category: "resource",
    })
  })
})
