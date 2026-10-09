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
    expect(resolveStorybookPackagePageTarget({...fixture.input, previewRevision: null})).toMatchObject({kind: "revision", revision: "revision-b", fallbackRevision: null, initialAppliedRevision: null})
  })


  test("normal navigation reuses the same published platform without ordering a build", async () => {
    const f = platformFixture()
    expect(await f.prepare("a".repeat(64))).toMatchObject({kind: "revision", revision: "revision-b"})
    expect(f.calls).toEqual([])
  })

  test("only the selected package is rebuilt once for a newer published platform", async () => {
    const f = platformFixture()
    const target = await f.prepare("b".repeat(64))
    expect(target).toMatchObject({kind: "revision", revision: "revision-c", fallbackRevision: null, initialAppliedRevision: null})
    expect(f.calls).toEqual([{packageId: "@fixture/package", owner: "open", reason: "toolchain-changed"}])
    expect(f.snapshot().activeRevision).toBe("revision-a")
    expect(await f.prepare("b".repeat(64))).toMatchObject({kind: "revision", revision: "revision-c"})
    expect(f.calls).toHaveLength(1)
  })

  test("failed platform alignment preserves old working artifacts and returns current-host fallback", async () => {
    const f = platformFixture(true)
    const target = await f.prepare("b".repeat(64))
    expect(target).toEqual({kind: "fallback", packageId: "@fixture/package", revision: null, intent: "reader", preview: false, initialAppliedRevision: null})
    expect(f.snapshot()).toMatchObject({activeRevision: "revision-a", lastWorkingRevision: "revision-a", buildState: "failed", diagnostics: [{phase: "compile", message: "new platform failed"}]})
    expect(f.calls).toEqual([{packageId: "@fixture/package", owner: "open", reason: "toolchain-changed"}])
  })

  test("exact old-platform preview remains exact and never starts alignment", async () => {
    const f = platformFixture()
    expect(await f.prepare("b".repeat(64), "revision-a")).toMatchObject({kind: "revision", revision: "revision-a", intent: "preview", preview: true})
    expect(f.calls).toEqual([])
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
    sharedModuleEpoch: "a".repeat(64),
    dependencyRealpaths: [],
    diagnostics: [],
    createdAt: "2026-09-11T00:00:00.000Z",
    leases: 0,
  }
}


function platformFixture(fail = false) {
  const fixture = targetFixture()
  let snapshot = fixture.input.snapshot
  const calls: {packageId: string, owner: string, reason: string}[] = []
  const session = {
    packageId: "@fixture/package",
    snapshot: () => snapshot,
    revisionGraphSnapshot: (revision: string) => fixture.revisions.get(revision)?.graphSnapshot ?? null,
    revisionDirectory: (revision: string) => fixture.revisions.has(revision) ? `/artifacts/${revision}` : null,
    async ensureBuilt() { throw new Error("Available revision must not use missing-build demand") },
    async build(demand: {owner: string, reason: string}) {
      calls.push({packageId: "@fixture/package", ...demand})
      const next = {...fixture.revisions.get("revision-b")!, sharedModuleEpoch: "b".repeat(64), status: fail ? "failed" as const : "built" as const}
      fixture.revisions.set("revision-c", next)
      snapshot = {...snapshot, generation: 3, builds: snapshot.builds + 1, builtRevision: fail ? null : "revision-c", failedRevision: fail ? "revision-c" : null,
        buildState: fail ? "failed" : "built", diagnostics: fail ? [{phase: "compile", message: "new platform failed", path: null}] : [],
        revisions: [...snapshot.revisions!, {...revisionRecord("revision-c", 3, next.status), sharedModuleEpoch: next.sharedModuleEpoch}]}
      return snapshot
    },
  } as unknown as PackageSessionContract.Output
  return {calls, snapshot: () => snapshot, prepare: (platformEpoch: string, previewRevision: string | null = null) => prepareStorybookPackagePageTarget({
    session, routePath: "dir-example", currentRoute: {nodeId: "example", kind: "overview"}, platformEpoch, previewRevision, signal: new AbortController().signal,
  })}
}
