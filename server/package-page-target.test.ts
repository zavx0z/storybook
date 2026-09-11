import {describe, expect, test} from "bun:test"
import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import type {StorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"
import {
  resolveStorybookPackagePageTarget,
  type StorybookPackagePageRevision,
} from "./package-page-target.ts"

describe("server package page target", () => {
  test("обычный cold request выбирает built, сохраняя правдивый active до evidence", () => {
    const fixture = targetFixture()
    const target = resolveStorybookPackagePageTarget({
      ...fixture.input,
      previewRevision: null,
    })

    expect(target).toMatchObject({
      kind: "revision",
      revision: "revision-b",
      intent: "navigation-candidate",
      preview: false,
      initialAppliedRevision: "revision-a",
      fallbackRevision: "revision-a",
      payloadUrl: "/__storybook/revisions/%40fixture%2Fpackage/revision-b/revision-payload.js",
    })
  })

  test("explicit preview сохраняет candidate и не получает navigation intent", () => {
    const fixture = targetFixture()
    const target = resolveStorybookPackagePageTarget({
      ...fixture.input,
      previewRevision: "revision-b",
    })

    expect(target).toMatchObject({
      kind: "revision",
      revision: "revision-b",
      intent: "preview",
      preview: true,
      initialAppliedRevision: "revision-a",
    })
  })

  test("failed preview redirects, а stale built не вытесняет working revision", () => {
    const fixture = targetFixture({builtStatus: "failed", builtGeneration: 1, generation: 2})
    const ordinary = resolveStorybookPackagePageTarget({...fixture.input, previewRevision: null})
    const preview = resolveStorybookPackagePageTarget({...fixture.input, previewRevision: "revision-b"})

    expect(ordinary).toMatchObject({kind: "revision", revision: "revision-a", intent: "reader"})
    expect(preview).toEqual({kind: "redirect-preview", packageId: "@fixture/package"})
  })

  test("новая revision без старого route переводит обычный переход в корень пакета", () => {
    const fixture = targetFixture({builtRoutes: [route("", "package-b", "overview")]})
    const target = resolveStorybookPackagePageTarget({...fixture.input, previewRevision: null})

    expect(target.kind).toBe("revision")
    if (target.kind !== "revision") throw new Error("Revision target expected")
    expect(target.route.path).toBe("")
  })
})

function targetFixture(options: Readonly<{
  builtStatus?: StorybookPackagePageRevision["status"]
  builtGeneration?: number
  generation?: number
  builtRoutes?: readonly ReturnType<typeof route>[]
}> = {}) {
  const packageId = "@fixture/package"
  const activeRoutes = [route("", "package-a", "overview"), route("example", "example", "variant")]
  const builtRoutes = options.builtRoutes ?? [route("", "package-b", "overview"), route("example", "example", "variant")]
  const revisions = new Map<string, StorybookPackagePageRevision>([
    ["revision-a", {graphSnapshot: graph(packageId, activeRoutes), entryRelativePath: "entry.js", status: "working"}],
    ["revision-b", {
      graphSnapshot: graph(packageId, builtRoutes),
      entryRelativePath: "entry.js",
      status: options.builtStatus ?? "built",
    }],
  ])
  const snapshot: StorybookPackageSessionSnapshot = {
    packageId,
    declarationDigest: "declaration",
    moduleGraphRevision: "module",
    candidateRevision: null,
    builtRevision: "revision-b",
    activatingRevision: null,
    activeRevision: "revision-a",
    lastWorkingRevision: "revision-a",
    lastGoodRevision: "revision-a",
    failedRevision: options.builtStatus === "failed" ? "revision-b" : null,
    packageGraphDigest: "graph-b",
    generation: options.generation ?? 2,
    entryRelativePath: "entry.js",
    diagnostics: [],
    dependencyRealpaths: [],
    revisions: [
      revisionRecord("revision-a", 1, "working"),
      revisionRecord("revision-b", options.builtGeneration ?? options.generation ?? 2, options.builtStatus ?? "built"),
    ],
    subscribers: 1,
    buildState: options.builtStatus === "failed" ? "failed" : "built",
    builds: 2,
  }
  return {
    input: {
      packageId,
      routePath: "example",
      currentRoute: {nodeId: "example", kind: "variant" as const},
      snapshot,
      readRevision: (revision: string) => revisions.get(revision) ?? null,
    },
  }
}

function route(path: string, nodeId: string, kind: "overview" | "variant") {
  return {path, nodeId, kind, urlPath: `/pkg-fixture-package/${path}`}
}

function graph(
  packageId: string,
  routes: readonly ReturnType<typeof route>[],
): StorybookPackageRevisionGraphSnapshot {
  return {
    packageId,
    packageGraphDigest: routes[0]?.nodeId ?? "graph",
    routes,
  } as StorybookPackageRevisionGraphSnapshot
}

function revisionRecord(
  revision: string,
  generation: number,
  status: StorybookPackagePageRevision["status"],
) {
  return {
    revision,
    generation,
    status,
    declarationDigest: "declaration",
    packageGraphDigest: `graph-${revision}`,
    moduleGraphRevision: `module-${revision}`,
    entryRelativePath: "entry.js",
    dependencyRealpaths: [],
    diagnostics: [],
    createdAt: "2026-09-11T00:00:00.000Z",
    leases: 0,
  }
}
