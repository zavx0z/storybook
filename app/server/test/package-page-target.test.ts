import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import {type StorybookPackageRevision as PackageRevisionContract} from "@zavx0z/storybook-package-revision"
type StorybookPackageSessionSnapshot = ReturnType<PackageSessionContract.Output["snapshot"]>
type StorybookPackageRevisionGraphSnapshot = ReturnType<PackageRevisionContract.Output["create"]>
import {describe, expect, test} from "bun:test"
import {
  prepareStorybookPackagePageTarget,
  resolveStorybookPackagePageTarget,
  type StorybookPackagePageRevision,
} from "../src/package-page-target.ts"

describe("server package page target", () => {
  test("неудачная первая сборка оставляет diagnostics и открывает fallback без выдуманной ревизии", async () => {
    const fixture = targetFixture()
    let state: StorybookPackageSessionSnapshot = {
      ...fixture.input.snapshot,
      builtRevision: null,
      activeRevision: null,
      lastWorkingRevision: null,
      lastGoodRevision: null,
      revisions: [],
      diagnostics: [],
      buildState: "idle",
      builds: 0,
    }
    let attempts = 0
    const session = {
      packageId: "@fixture/package",
      snapshot: () => state,
      revisionGraphSnapshot: () => null,
      revisionDirectory: () => null,
      async ensureBuilt() {
        attempts += 1
        state = {...state, buildState: "failed", builds: 1,
          diagnostics: [{phase: "compile", message: "broken package entry", path: null}]}
        return state
      },
    } as unknown as PackageSessionContract.Output
    const target = await prepareStorybookPackagePageTarget({
      session,
      routePath: "",
      previewRevision: null,
      currentRoute: {nodeId: "package-a", kind: "overview"},
      signal: new AbortController().signal,
    })
    expect(target).toEqual({kind: "fallback", packageId: "@fixture/package", revision: null,
      intent: "reader", preview: false, initialAppliedRevision: null})
    expect(attempts).toBe(1)
    expect(state.buildState).toBe("failed")
    expect(state.diagnostics).toEqual([{phase: "compile", message: "broken package entry", path: null}])
    expect(state.activeRevision).toBeNull()
  })

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

  test("старая рабочая ревизия открывает текущую оболочку без загрузки legacy payload", () => {
    const fixture = targetFixture()
    fixture.input.snapshot = {...fixture.input.snapshot, builtRevision: null}
    const previous = fixture.revisions.get("revision-a")!
    fixture.revisions.set("revision-a", {...previous, sharedModuleEpoch: undefined})
    const target = resolveStorybookPackagePageTarget({...fixture.input, previewRevision: null})
    expect(target).toEqual({kind: "fallback", packageId: "@fixture/package", revision: null,
      intent: "reader", preview: false, initialAppliedRevision: null})
    expect(fixture.input.snapshot.activeRevision).toBe("revision-a")
    expect(fixture.input.snapshot.lastWorkingRevision).toBe("revision-a")
  })

  test("явный preview старого формата также не загружает закреплённую оболочку", () => {
    const fixture = targetFixture()
    fixture.revisions.set("revision-a", {...fixture.revisions.get("revision-a")!, sharedModuleEpoch: undefined})
    expect(resolveStorybookPackagePageTarget({...fixture.input, previewRevision: "revision-a"}).kind).toBe("fallback")
    expect(resolveStorybookPackagePageTarget({...fixture.input, previewRevision: null})).toMatchObject({kind: "revision", revision: "revision-b", fallbackRevision: null, initialAppliedRevision: "revision-a"})
  })

})

function targetFixture(options: Readonly<{
  builtStatus?: StorybookPackagePageRevision["status"]
  builtGeneration?: number
  generation?: number
  builtRoutes?: readonly ReturnType<typeof route>[]
}> = {}) {
  const packageId = "@fixture/package"
  const activeRoutes = [route("", "package-a", "overview"), route("dir-example", "example", "overview")]
  const builtRoutes = options.builtRoutes ?? [route("", "package-b", "overview"), route("dir-example", "example", "overview")]
  const revisions = new Map<string, StorybookPackagePageRevision>([
    ["revision-a", {graphSnapshot: graph(packageId, activeRoutes), entryRelativePath: "entry.js", sharedModuleEpoch: "a".repeat(64), status: "working"}],
    ["revision-b", {
      graphSnapshot: graph(packageId, builtRoutes),
      entryRelativePath: "entry.js",
      sharedModuleEpoch: "a".repeat(64),
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
    revisions,
    input: {
      packageId,
      routePath: "dir-example",
      currentRoute: {nodeId: "example", kind: "overview" as const},
      snapshot,
      readRevision: (revision: string) => revisions.get(revision) ?? null,
    },
  }
}

function route(path: string, nodeId: string, kind: "overview") {
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
