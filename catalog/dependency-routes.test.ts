import {expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {createExternalStorybookGraph, externalStorybookRoutes, resolveExternalStorybookRoute} from "./graph.ts"
import {createExternalStorybookClientSnapshot} from "../runtime/client-protocol.ts"
import {deriveExternalStorybookPackageTab} from "../runtime/model.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"
import {storybookPackageRouteFromPathname, storybookPackageUrlPath} from "@zavx0z/storybook-browser-lifecycle/contract"

async function declarations(bound: boolean, collision = false) {
  const catalog = await resolveExternalStorybookDeclarations([join(import.meta.dir, "../discovery/fixtures/valid/standalone")])
  const scope = catalog.scopes[0]!
  if (scope.kind !== "package") throw new Error("Fixture должен быть пакетом")
  const category = scope.catalog!.categories[0]!
  const subject = category.subjects[0]!
  return {...catalog, scopes: [{...scope,
    directories: [{path: join(scope.scopeRoot, "module"), relativePath: "module", name: "module", structuralRole: "module" as const, readmePath: null,
      dependencySpec: {sourcePath: join(scope.scopeRoot, "module/spec/deps.spec.ts"), sourceDigest: "fixture", cases: [{name: "Example", file: "module/index.tsx", testName: "Состав", graph: {Example: {uses: [], elements: []}}}]}},
    ],
    catalog: {...scope.catalog!, categories: [{...category, id: "components", label: "Components", route: "components", subjects: [{
      ...subject,
      id: "example", kind: "component" as const, label: "Example", route: "example",
      ...(bound ? {directory: "module"} : {}),
      presentation: {protocol: "story-presentation/1" as const, projection: "display" as const, widgets: ["source", "diagnostics"]},
      variants: [{id: "basic", label: "Обычный", route: collision ? "example/dependencies" : "example/basic",
        group: null, module: null, resources: [], presentation: subject.presentation, source: subject.source}],
    }]}]},
  }]}
}

test.each([false, true])("Dependencies — собственный маршрут существующего владельца, bound=%s", async bound => {
  const graph = createExternalStorybookGraph(await declarations(bound))
  const packageId = "@fixture/standalone"
  const base = bound ? "example" : "dir-module"
  const path = `${base}/dependencies`
  const route = resolveExternalStorybookRoute(graph, packageId, path)
  expect(route.kind).toBe("dependencies")
  expect(route.nodeId).toBe(resolveExternalStorybookRoute(graph, packageId, base).nodeId)
  expect(storybookPackageRouteFromPathname(route.urlPath, packageId)).toBe(path)
  const client = createExternalStorybookClientSnapshot(graph, [{
    packageId, declarationDigest: "fixture", moduleGraphRevision: null, candidateRevision: null,
    activeRevision: "active", lastGoodRevision: "active", entryRelativePath: "entry.js", diagnostics: [],
    dependencyRealpaths: [], subscribers: 0, buildState: "active", builds: 0,
  }])
  for (const data of [graph, client]) {
    const selected = deriveExternalStorybookPackageTab(data, packageId, path)
    expect(selected.viewKind).toBe("dependencies")
    expect(selected.urlPath).toBe(route.urlPath)
    expect(selected.tabs.find(tab => tab.id === selected.tabActiveId)?.route).toBe(path)
    expect(selected.tabs.some(tab => tab.label === "Обзор")).toBeFalse()
    expect(deriveExternalStorybookPackageTab(data, packageId, base).tabActiveId).toBeNull()
  }
  expect(resolveExternalStorybookRoute(graph, packageId, "example/basic").kind).toBe("variant")
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(entry => entry.path === path)).toMatchObject({kind: "dependencies", nodeId: route.nodeId})
  expect(externalStorybookRoutes(graph).filter(entry => entry.path === path)).toHaveLength(1)
  expect(() => resolveExternalStorybookRoute(graph, packageId, "dir-absent/dependencies")).toThrow("Unknown")
})

test("коллизия authored variant с производной вкладкой отклоняется без подмены URL", async () => {
  const catalog = await declarations(true, true)
  expect(() => createExternalStorybookGraph(catalog)).toThrow("Duplicate normalized external Storybook route")
})

test("производный маршрут не перекрывает самостоятельный subject", async () => {
  const catalog = await declarations(true)
  const subjects = catalog.scopes[0]!.catalog.categories[0]!.subjects
  const {directory: _directory, ...base} = subjects[0]!
  subjects.push({...base, id: "collision", route: "example/dependencies", variants: []})
  expect(() => createExternalStorybookGraph(catalog)).toThrow("Duplicate normalized external Storybook route")
})

test("структурная цепочка допускает только конечный Dependencies, не произвольный mixed route", () => {
  expect(storybookPackageUrlPath("@fixture/a", "dir-category/dir-module/dependencies"))
    .toBe("/pkg-fixture-a/dir-category/dir-module/dependencies")
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dir-module/dependencies", "@fixture/a"))
    .toBe("dir-category/dir-module/dependencies")
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dependencies/dir-module", "@fixture/a")).toBeNull()
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/not-a-view", "@fixture/a")).toBeNull()
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dir-dependencies", "@fixture/a")).toBe("dir-category/dir-dependencies")
  const escaped = "dir-with%20%23%20hash/dependencies"
  expect(storybookPackageRouteFromPathname(storybookPackageUrlPath("@fixture/a", escaped), "@fixture/a")).toBe(escaped)
})
