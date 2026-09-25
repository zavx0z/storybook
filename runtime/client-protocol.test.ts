import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../catalog/graph.ts"
import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import {
  createExternalStorybookClientSnapshot,
  decodeExternalStorybookPackagePath,
  encodeExternalStorybookPackagePath,
  externalStorybookNodeResourceUrl,
} from "./client-protocol.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const fixtureGraph = async () => createExternalStorybookGraph(await discoverStorybookPackages([
  fixtureRoot, join(fixtureRoot, "standalone"),
]))

describe("structural browser client protocol", () => {
  test("projects physical graph and session status without owner paths", async () => {
    const graph = await fixtureGraph()
    const hiddenDiagnostic = join(fixtureRoot, "projects", "alpha", "broken.ts")
    const sessions = packageSnapshots(graph).map(session => session.packageId === "@fixture/components"
      ? {...session, buildState: "failed" as const, diagnostics: [{phase: "compile" as const,
        message: `Unexpected token in ${hiddenDiagnostic}`, path: hiddenDiagnostic}], dependencyRealpaths: [hiddenDiagnostic]}
      : session)
    const client = createExternalStorybookClientSnapshot(graph, sessions)
    const owner = client.nodes.find(node => node.id === "package:@fixture/components")!
    const directory = client.nodes.find(node => node.id === "directory:package:@fixture/components/docs")!
    expect(owner).toMatchObject({kind: "package", ownerId: "@fixture/components", directoryName: "components"})
    expect(directory).toMatchObject({kind: "directory", parentId: owner.id, routePath: "dir-docs"})
    expect(directory.resourceUrl).toBe(externalStorybookNodeResourceUrl(graph, directory.id))
    expect(client.packages.find(item => item.packageId === "@fixture/components")?.diagnostics[0]?.message).toBe("Unexpected token in [owner-path]")
    const serialized = JSON.stringify(client)
    for (const forbidden of [fixtureRoot, hiddenDiagnostic, '"packageJsonPath"', '"readmePath"', '"hasReadme"', '"dependencyRealpaths"', '"entryRelativePath"']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(JSON.parse(serialized)).toEqual(client)
    expect(Object.isFrozen(client)).toBeTrue()
    expect(client.nodes.every(node => Object.isFrozen(node))).toBeTrue()
  })

  test("encodes exact package identities in one path segment", () => {
    expect(encodeExternalStorybookPackagePath("@zavx0z/dom")).toBe("pkg-zavx0z-dom")
    const encoded = encodeExternalStorybookPackagePath("@fixture/components")
    expect(encoded).toBe("pkg-fixture-components")
    expect(decodeExternalStorybookPackagePath(encoded, ["@fixture/components"])).toBe("@fixture/components")
    for (const path of ["@fixture/components", "%40fixture%2fcomponents", "%broken"]) {
      expect(() => decodeExternalStorybookPackagePath(path, ["@fixture/components"])).toThrow()
    }
    expect(() => decodeExternalStorybookPackagePath(encoded, ["@fixture/components", "fixture-components"])).toThrow("ambiguous")
  })

  test("rejects unknown and duplicate session identities", async () => {
    const graph = await fixtureGraph()
    const snapshots = packageSnapshots(graph)
    expect(() => externalStorybookNodeResourceUrl(graph, "directory:missing")).toThrow("Unknown external Storybook graph identity")
    expect(() => createExternalStorybookClientSnapshot(graph, snapshots.slice(1))).toThrow("Missing external Storybook client package session")
    expect(() => createExternalStorybookClientSnapshot(graph, [snapshots[0]!, snapshots[0]!, ...snapshots.slice(1)])).toThrow("Duplicate external Storybook client package session")
    expect(() => createExternalStorybookClientSnapshot(graph, [...snapshots, sessionSnapshot("@fixture/unknown")])).toThrow("Unknown external Storybook client package session")
  })

  test("rejects broken graph references", async () => {
    const graph = await fixtureGraph()
    const broken = {...graph, rootIds: ["package:missing"]} as ExternalStorybookGraph
    expect(() => createExternalStorybookClientSnapshot(broken, packageSnapshots(graph))).toThrow("Unknown external Storybook client root")
  })
})

function packageSnapshots(graph: ExternalStorybookGraph): StorybookPackageSessionSnapshot[] {
  return graph.nodes.filter(node => node.kind === "package").map(node => sessionSnapshot(node.packageId!))
}

function sessionSnapshot(packageId: string): StorybookPackageSessionSnapshot {
  return {
    packageId,
    declarationDigest: `package-${packageId.replaceAll("/", "-")}`,
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
  }
}
