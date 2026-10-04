import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"
import createExternalStorybookGraph, {type StorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
type ExternalStorybookGraph = StorybookPackageGraphCreate.Output
import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"
type StorybookPackageSessionSnapshot = ReturnType<StorybookPackageSession.Output["snapshot"]>
import WebProtocol from "@zavx0z/storybook-app-web-protocol"

const fixtureRoot = join(import.meta.dir, "../../../../package/metadata/collect/fixtures/valid")
const fixtureGraph = async () => createExternalStorybookGraph(await discoverStorybookPackages([
  fixtureRoot, join(fixtureRoot, "standalone"),
]))

describe("structural browser client protocol", () => {
  test("требует имя Project независимо от состава пакетов", () => {
    const graph = createExternalStorybookGraph({schemaVersion: 1, rootIds: [], scopes: []})
    expect(WebProtocol.clientSnapshot(graph, [], "Другой Project").projectName).toBe("Другой Project")
    for (const name of ["", " ", undefined, 42]) {
      expect(() => WebProtocol.clientSnapshot(graph, [], name as string)).toThrow("project name must be non-empty text")
    }
  })

  test("предупреждения стандарта видны отдельно от блокирующих ошибок", async () => {
    const graph = await fixtureGraph()
    const path = join(fixtureRoot, "projects", "alpha", "index.ts")
    const snapshots = packageSnapshots(graph).map(snapshot => ({...snapshot, standard: "transition" as const,
      warnings: [{phase: "validate" as const, path, message: `Незавершённый стандарт ${path}`}]}))
    const result = WebProtocol.clientSnapshot(graph, snapshots, "Fixture Project")
    expect(result.packages[0]).toMatchObject({standard: "transition", diagnostics: [],
      warnings: [{phase: "validate", message: "Незавершённый стандарт [owner-path]"}]})
    expect(JSON.stringify(result)).not.toContain(path)
  })

  test("projects physical graph and session status without owner paths", async () => {
    const graph = await fixtureGraph()
    const hiddenDiagnostic = join(fixtureRoot, "projects", "alpha", "broken.ts")
    const sessions = packageSnapshots(graph).map(session => session.packageId === "@fixture/components"
      ? {...session, buildState: "failed" as const, diagnostics: [{phase: "compile" as const,
        message: `Unexpected token in ${hiddenDiagnostic}`, path: hiddenDiagnostic}], dependencyRealpaths: [hiddenDiagnostic]}
      : session)
    const client = WebProtocol.clientSnapshot(graph, sessions, "Fixture Project")
    expect(client.projectName).toBe("Fixture Project")
    const owner = client.nodes.find(node => node.id === "package:@fixture/components")!
    const directory = client.nodes.find(node => node.id === "directory:package:@fixture/components/docs")!
    expect(owner).toMatchObject({kind: "package", ownerId: "@fixture/components", directoryName: "components"})
    expect(directory).toMatchObject({kind: "directory", parentId: owner.id, routePath: "dir-docs"})
    expect(directory.resourceUrl).toBe(WebProtocol.nodeResourceUrl(graph, directory.id))
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
    expect(WebProtocol.encodePackagePath("@zavx0z/immersive-dom")).toBe("pkg-zavx0z-immersive-dom")
    const encoded = WebProtocol.encodePackagePath("@fixture/components")
    expect(encoded).toBe("pkg-fixture-components")
    expect(WebProtocol.decodePackagePath(encoded, ["@fixture/components"])).toBe("@fixture/components")
    for (const path of ["@fixture/components", "%40fixture%2fcomponents", "%broken"]) {
      expect(() => WebProtocol.decodePackagePath(path, ["@fixture/components"])).toThrow()
    }
    expect(() => WebProtocol.decodePackagePath(encoded, ["@fixture/components", "fixture-components"])).toThrow("ambiguous")
  })

  test("rejects unknown and duplicate session identities", async () => {
    const graph = await fixtureGraph()
    const snapshots = packageSnapshots(graph)
    expect(() => WebProtocol.nodeResourceUrl(graph, "directory:missing")).toThrow("Unknown external Storybook graph identity")
    expect(() => WebProtocol.clientSnapshot(graph, snapshots.slice(1), "Fixture Project")).toThrow("Missing external Storybook client package session")
    expect(() => WebProtocol.clientSnapshot(graph, [snapshots[0]!, snapshots[0]!, ...snapshots.slice(1)], "Fixture Project")).toThrow("Duplicate external Storybook client package session")
    expect(() => WebProtocol.clientSnapshot(graph, [...snapshots, sessionSnapshot("@fixture/unknown")], "Fixture Project")).toThrow("Unknown external Storybook client package session")
  })

  test("rejects broken graph references", async () => {
    const graph = await fixtureGraph()
    const broken = {...graph, rootIds: ["package:missing"]} as ExternalStorybookGraph
    expect(() => WebProtocol.clientSnapshot(broken, packageSnapshots(graph), "Fixture Project")).toThrow("Unknown external Storybook client root")
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
