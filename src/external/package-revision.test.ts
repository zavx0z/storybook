import {describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {createExternalStorybookGraph} from "./graph.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
  validateStorybookPackageRevisionGraphSnapshot,
} from "./package-revision.ts"

const fixtureRoot = join(import.meta.dir, "fixtures", "valid")
const storybookRoot = join(import.meta.dir, "..", "..")

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
    expect(snapshot.ancestors).toEqual([
      {
        id: "workspace:fixture-workspace",
        kind: "workspace",
        label: "Fixture Workspace",
        urlPath: "/workspaces/fixture-workspace/",
      },
      {
        id: "project:fixture-alpha",
        kind: "project",
        label: "Fixture Alpha",
        urlPath: "/projects/fixture-alpha/",
      },
    ])
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
    expect(snapshot.authorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([
      {specifier: "@fixture/components/tokens.css", url: "author-style-sheets/0.css"},
      {specifier: "@fixture/components/theme.css", url: "author-style-sheets/1.css"},
    ])
    expect(snapshot.authorStyleSheets.every(({contentDigest}) => /^[a-f0-9]{64}$/u.test(contentDigest))).toBeTrue()
    expect(snapshot.workbenchAuthorStyleSheets).toEqual([])
    expect(snapshot.widgetContributions).toEqual({
      protocol: "widget-contribution/1",
      items: [{id: "fixture-controls", kind: "component", label: "Fixture controls"}],
    })
    expect(snapshot.widgetLoaders).toEqual([{id: "fixture-controls", exportName: "FixtureControlsWidget"}])
    expect(JSON.stringify(snapshot.widgetContributions)).not.toContain(".storybook")
    const buttonSubject = snapshot.nodes.find(({id}) => id === "subject:@fixture/components/components/button")
    const contained = snapshot.nodes.find(({id}) => id === "variant:@fixture/components/components/button/contained")
    expect(buttonSubject?.presentation).toEqual({
      protocol: "story-presentation/1",
      projection: "display",
      widgets: ["props", "source", "diagnostics"],
    })
    expect(contained?.presentation).toEqual(buttonSubject?.presentation)
    expect(JSON.stringify(snapshot)).not.toContain(fixtureRoot)
    expect(snapshot.packageGraphDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  test("keeps Workbench and active package author sheets as separate revision collections", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
      storybookRoot,
      fixtureRoot,
    ]))
    const snapshot = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "declaration-components-with-workbench",
    )
    expect(snapshot.workbenchAuthorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([{
      specifier: "@zavx0z/ui/themes/theme.css",
      url: "workbench-author-style-sheets/0.css",
    }])
    expect(snapshot.authorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([
      {specifier: "@fixture/components/tokens.css", url: "author-style-sheets/0.css"},
      {specifier: "@fixture/components/theme.css", url: "author-style-sheets/1.css"},
    ])
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
    expect(() => validateStorybookPackageRevisionGraphSnapshot({
      ...snapshot,
      protocol: "storybook-package-graph/1",
    } as never)).toThrow("Unsupported Storybook package graph protocol")

    const nestedSnapshot = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "nested-ancestors",
    )
    const reversedAncestors = redigest({
      ...nestedSnapshot,
      ancestors: [nestedSnapshot.ancestors[1]!, nestedSnapshot.ancestors[0]!],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(reversedAncestors))
      .toThrow("ancestor sequence is invalid")

    const workspaceWithoutProject = redigest({
      ...nestedSnapshot,
      ancestors: [nestedSnapshot.ancestors[0]!],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(workspaceWithoutProject))
      .toThrow("ancestor sequence is invalid")

    const externalAncestorUrl = redigest({
      ...nestedSnapshot,
      ancestors: [
        nestedSnapshot.ancestors[0]!,
        {...nestedSnapshot.ancestors[1]!, urlPath: "https://example.com/projects/fixture-alpha/"},
      ],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(externalAncestorUrl))
      .toThrow("ancestor URL is not canonical")

    const mismatchedAncestorId = redigest({
      ...nestedSnapshot,
      ancestors: [
        nestedSnapshot.ancestors[0]!,
        {...nestedSnapshot.ancestors[1]!, id: "workspace:fixture-alpha"},
      ],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(mismatchedAncestorId))
      .toThrow("ancestor identity does not match its kind")
  })

  test("rejects duplicate specifiers and non-canonical author stylesheet revision URLs", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([fixtureRoot]))
    const snapshot = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "declaration-components",
    )
    const duplicate = redigest({
      ...snapshot,
      authorStyleSheets: [
        snapshot.authorStyleSheets[0]!,
        {...snapshot.authorStyleSheets[1]!, specifier: snapshot.authorStyleSheets[0]!.specifier},
      ],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(duplicate))
      .toThrow("Duplicate Storybook author stylesheet specifier")
    const wrongUrl = redigest({
      ...snapshot,
      authorStyleSheets: [
        {...snapshot.authorStyleSheets[0]!, url: "theme.css"},
        snapshot.authorStyleSheets[1]!,
      ],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(wrongUrl))
      .toThrow("URL is not canonical")
    const dependencyOwned = redigest({
      ...snapshot,
      authorStyleSheets: [
        {...snapshot.authorStyleSheets[0]!, specifier: "@fixture/theme/theme.css"},
        snapshot.authorStyleSheets[1]!,
      ],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(dependencyOwned)).not.toThrow()
    const workbenchOwned = redigest({
      ...snapshot,
      workbenchAuthorStyleSheets: [{
        specifier: "@zavx0z/ui/themes/theme.css",
        url: "workbench-author-style-sheets/0.css",
        contentDigest: snapshot.authorStyleSheets[0]!.contentDigest,
      }],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(workbenchOwned)).not.toThrow()
    const wrongWorkbenchUrl = redigest({
      ...workbenchOwned,
      workbenchAuthorStyleSheets: [{
        ...workbenchOwned.workbenchAuthorStyleSheets[0]!,
        url: "author-style-sheets/0.css",
      }],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(wrongWorkbenchUrl))
      .toThrow("URL is not canonical")
  })

  test("rejects mutated widget registries, loaders and inherited presentations", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([fixtureRoot]))
    const snapshot = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "declaration-components",
    )
    const wrongLoader = redigest({
      ...snapshot,
      widgetLoaders: [{...snapshot.widgetLoaders[0]!, exportName: "missing export"}],
    })
    expect(() => validateStorybookPackageRevisionGraphSnapshot(wrongLoader))
      .toThrow("widget loader export")

    const containedIndex = snapshot.nodes.findIndex(({id}) =>
      id === "variant:@fixture/components/components/button/contained")
    const wrongPresentationNodes = snapshot.nodes.map((node, index) => index === containedIndex
      ? {...node, presentation: {...node.presentation!, projection: "hud" as const}}
      : node)
    const wrongPresentation = redigest({...snapshot, nodes: wrongPresentationNodes})
    expect(() => validateStorybookPackageRevisionGraphSnapshot(wrongPresentation))
      .toThrow("does not inherit its subject")

    const subjectIndex = snapshot.nodes.findIndex(({id}) =>
      id === "subject:@fixture/components/components/button")
    const subjectId = snapshot.nodes[subjectIndex]!.id
    const spacePresentationNodes = snapshot.nodes.map(node =>
      node.id === subjectId || node.kind === "variant" && node.parentId === subjectId
        ? {...node, presentation: {...node.presentation!, projection: "space" as const}}
        : node)
    const spacePresentation = redigest({...snapshot, nodes: spacePresentationNodes})
    expect(() => validateStorybookPackageRevisionGraphSnapshot(spacePresentation)).not.toThrow()

    const legacyWorldNodes = snapshot.nodes.map(node =>
      node.id === subjectId || node.kind === "variant" && node.parentId === subjectId
        ? {...node, presentation: {...node.presentation!, projection: "world" as never}}
        : node)
    const legacyWorld = redigest({...snapshot, nodes: legacyWorldNodes})
    expect(() => validateStorybookPackageRevisionGraphSnapshot(legacyWorld))
      .toThrow("Invalid Storybook story presentation")

    const unknownWidgetNodes = snapshot.nodes.map((node, index) => index === subjectIndex
      ? {...node, presentation: {...node.presentation!, widgets: [...node.presentation!.widgets, "missing"]}}
      : node.kind === "variant" && node.parentId === snapshot.nodes[subjectIndex]!.id
        ? {...node, presentation: {...node.presentation!, widgets: [...node.presentation!.widgets, "missing"]}}
        : node)
    const unknownWidget = redigest({...snapshot, nodes: unknownWidgetNodes})
    expect(() => validateStorybookPackageRevisionGraphSnapshot(unknownWidget))
      .toThrow("Unknown Storybook story presentation widget")
  })
})

function redigest(
  value: StorybookPackageRevisionGraphSnapshot,
): StorybookPackageRevisionGraphSnapshot {
  const {packageGraphDigest: _previous, ...withoutDigest} = value
  return {
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  }
}
