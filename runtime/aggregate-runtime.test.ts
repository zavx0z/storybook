import {describe, expect, test} from "bun:test"
import {createDocument} from "@zavx0z/dom"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {deriveExternalStorybookPackageTab} from "./model.ts"
import {
  mountStorybookAggregateChildren,
  planStorybookOverview,
  type StorybookOverviewPlanItem,
} from "./aggregate-runtime.ts"

describe("external Storybook aggregate runtime", () => {
  test("keeps variant-free documentation subjects as overview states without creating executable children", async () => {
    const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
      fixtureRoot,
      join(fixtureRoot, "standalone"),
    ]))
    const snapshot = createExternalStorybookClientSnapshot(graph, graph.nodes.flatMap(node =>
      node.kind === "package" ? [{
        packageId: node.packageId!,
        declarationDigest: node.digest,
        moduleGraphRevision: "fixture",
        candidateRevision: null,
        activeRevision: "fixture",
        lastGoodRevision: "fixture",
        entryRelativePath: "entry.js",
        diagnostics: [],
        dependencyRealpaths: [],
        subscribers: 0,
        buildState: "ready" as const,
        builds: 1,
      }] : [],
    ))
    for (const route of ["foundation", "foundation/event-target"]) {
      const model = deriveExternalStorybookPackageTab(graph, "@fixture/components", route)
      expect(planStorybookOverview(snapshot, model)).toEqual([])
      expect(model.selectedNode.routePath).toBe(route)
    }
    const executable = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components")
    expect(planStorybookOverview(snapshot, executable).map(({route}) => route))
      .toEqual(["components/button/basic/contained"])
  })

  test("rejects a Space subject before creating a DOM aggregate session", async () => {
    const document = createDocument()
    let creates = 0
    const plan: readonly StorybookOverviewPlanItem[] = [Object.freeze({
      id: "space",
      label: "Space",
      route: "space/default",
      subject: Object.freeze({
        id: "subject:@fixture/space",
        kind: "subject" as const,
        presentation: Object.freeze({
          protocol: "story-presentation/1" as const,
          projection: "space" as const,
          widgets: Object.freeze(["source", "diagnostics"]),
        }),
      }),
    })]

    await expect(mountStorybookAggregateChildren({
      document,
      adapter: {
        protocol: "storybook-runtime/4",
        create() {
          creates += 1
          throw new Error("Space aggregate adapter must not run")
        },
      },
      plan,
      signal: new AbortController().signal,
      async loadStory() {
        throw new Error("Space aggregate story must not load")
      },
      present() {
        throw new Error("Space aggregate must not publish")
      },
      validatePresentation() {},
      reportDiagnostic() {},
      requestRender() {},
    })).rejects.toThrow("Storybook Space subject cannot be materialized in a DOM aggregate")
    expect(creates).toBe(0)
  })
})
