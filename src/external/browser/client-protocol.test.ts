import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../graph.ts"
import type {StorybookPackageSessionSnapshot} from "../package-session.ts"
import {
  createExternalStorybookClientSnapshot,
  decodeExternalStorybookPackagePath,
  encodeExternalStorybookPackagePath,
  externalStorybookNodeResourceUrl,
} from "./client-protocol.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook browser client protocol", () => {
  test("projects graph semantics and package status without owner filesystem data", async () => {
    const graph = await fixtureGraph()
    const hiddenDependency = join(fixtureRoot, "private", "dependency.ts")
    const hiddenDiagnostic = join(fixtureRoot, "projects", "alpha", "broken.ts")
    const snapshots = packageSnapshots(graph, {
      "@fixture/components": {
        buildState: "failed",
        activeRevision: "revision-good",
        lastGoodRevision: "revision-good",
        diagnostics: [{
          phase: "compile",
          message: `Unexpected token in ${hiddenDiagnostic}; imported from /unlisted/private/source.ts`,
          path: hiddenDiagnostic,
        }],
        dependencyRealpaths: [hiddenDependency],
      },
    })

    const client = createExternalStorybookClientSnapshot(graph, snapshots)
    const subject = client.nodes.find(({id}) =>
      id === "subject:@fixture/components/foundation/event-target")!
    const variant = client.nodes.find(({id}) =>
      id === "variant:@fixture/components/components/button/contained")!
    expect(subject).toMatchObject({
      kind: "subject",
      ownerId: "@fixture/components",
      packageId: "@fixture/components",
      parentId: "category:@fixture/components/foundation",
      routePath: "foundation/event-target",
      subjectKind: "interface",
      apiName: "EventTarget",
      hasReadme: true,
      resourceKinds: [],
    })
    expect(variant.group).toEqual({id: "basic", label: "Basic"})
    expect(variant.resourceKinds).toEqual(["fixture", "test", "reference", "asset"])
    expect(variant.resourceUrl).toBe(externalStorybookNodeResourceUrl(graph, variant.id))
    expect(variant.searchTerms).toContain("contained")

    const failed = client.packages.find(({packageId}) => packageId === "@fixture/components")!
    expect(failed).toMatchObject({
      activeRevision: "revision-good",
      lastGoodRevision: "revision-good",
      buildState: "failed",
      diagnostics: [{
        phase: "compile",
        message: "Unexpected token in [owner-path]; imported from [owner-path]",
      }],
    })
    const serialized = JSON.stringify(client)
    for (const forbidden of [
      fixtureRoot,
      hiddenDependency,
      hiddenDiagnostic,
      '"manifestPath"',
      '"packageJsonPath"',
      '"readmePath"',
      '"dependencyRealpaths"',
      '"entryRelativePath"',
      '"module"',
      "# Fixture Components",
    ]) expect(serialized).not.toContain(forbidden)
    expect(JSON.parse(serialized)).toEqual(client)
    expect(Object.isFrozen(client)).toBeTrue()
    expect(client.nodes.every((node) => Object.isFrozen(node))).toBeTrue()
  })

  test("encodes package identities as one exact canonical path segment", () => {
    const encoded = encodeExternalStorybookPackagePath("@fixture/components")
    expect(encoded).toBe("%40fixture%2Fcomponents")
    expect(decodeExternalStorybookPackagePath(encoded)).toBe("@fixture/components")
    for (const path of [
      "@fixture/components",
      "%40fixture%2fcomponents",
      "%40fixture%2Fcomponents/extra",
      "%broken",
      "%40Fixture%2Fcomponents",
    ]) expect(() => decodeExternalStorybookPackagePath(path)).toThrow()
    expect(() => encodeExternalStorybookPackagePath("fixture/components")).toThrow()
  })

  test("projects every package-session diagnostic phase", async () => {
    const graph = await fixtureGraph()
    const phases = [
      "resolve",
      "validate",
      "compile",
      "link",
      "protocol",
      "publish",
      "watch",
      "activation",
      "timeout",
    ] as const
    const snapshots = packageSnapshots(graph, {
      "@fixture/components": {
        buildState: "failed",
        diagnostics: phases.map((phase) => ({phase, message: `${phase} diagnostic`, path: null})),
      },
    })
    const client = createExternalStorybookClientSnapshot(graph, snapshots)
    expect(client.packages.find(({packageId}) => packageId === "@fixture/components")?.diagnostics)
      .toEqual(phases.map((phase) => ({phase, message: `${phase} diagnostic`})))
  })

  test("projects Space as the only spatial presentation identity", async () => {
    const graph = await fixtureGraph()
    const subjectId = "subject:@fixture/components/components/button"
    const spatialGraph: ExternalStorybookGraph = {
      ...graph,
      nodes: Object.freeze(graph.nodes.map(node => node.id === subjectId
        ? Object.freeze({
            ...node,
            presentation: Object.freeze({
              ...node.presentation!,
              projection: "space" as const,
            }),
          })
        : node)),
    }
    const client = createExternalStorybookClientSnapshot(
      spatialGraph,
      packageSnapshots(spatialGraph),
    )

    expect(client.nodes.find(({id}) => id === subjectId)?.presentation?.projection).toBe("space")
    expect(JSON.stringify(client)).not.toContain('"projection":"world"')
  })

  test("fails closed for unknown resource and session identities", async () => {
    const graph = await fixtureGraph()
    const snapshots = packageSnapshots(graph)
    expect(() => externalStorybookNodeResourceUrl(graph, "variant:missing"))
      .toThrow("Unknown external Storybook graph identity")
    expect(() => createExternalStorybookClientSnapshot(graph, snapshots.slice(1)))
      .toThrow("Missing external Storybook client package session")
    expect(() => createExternalStorybookClientSnapshot(graph, [snapshots[0]!, snapshots[0]!, ...snapshots.slice(1)]))
      .toThrow("Duplicate external Storybook client package session")
    expect(() => createExternalStorybookClientSnapshot(graph, [
      ...snapshots,
      sessionSnapshot("@fixture/unknown"),
    ])).toThrow("Unknown external Storybook client package session")
  })

  test("fails closed for broken graph references", async () => {
    const graph = await fixtureGraph()
    const broken = {
      ...graph,
      rootIds: ["workspace:missing"],
    } as ExternalStorybookGraph
    expect(() => createExternalStorybookClientSnapshot(broken, packageSnapshots(graph)))
      .toThrow("Unknown external Storybook client root")
  })
})

async function fixtureGraph(): Promise<ExternalStorybookGraph> {
  return createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
    fixtureRoot,
    join(fixtureRoot, "standalone"),
  ]))
}

function packageSnapshots(
  graph: ExternalStorybookGraph,
  overrides: Readonly<Record<string, Partial<StorybookPackageSessionSnapshot>>> = {},
): readonly StorybookPackageSessionSnapshot[] {
  return graph.nodes
    .filter(({kind}) => kind === "package")
    .map(({packageId}) => sessionSnapshot(packageId!, overrides[packageId!] ?? {}))
}

function sessionSnapshot(
  packageId: string,
  override: Partial<StorybookPackageSessionSnapshot> = {},
): StorybookPackageSessionSnapshot {
  return {
    packageId,
    declarationDigest: `declaration-${packageId.slice(1).replaceAll("/", "-")}`,
    moduleGraphRevision: "module-graph",
    candidateRevision: null,
    activeRevision: "revision-active",
    lastGoodRevision: "revision-active",
    entryRelativePath: "entry.js",
    diagnostics: [],
    dependencyRealpaths: [],
    subscribers: 0,
    buildState: "ready",
    builds: 1,
    ...override,
  }
}
