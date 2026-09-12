import {expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {createExternalStorybookGraph, resolveExternalStorybookRoute} from "./graph.ts"
import {externalStorybookPackageDescriptors} from "../build/package-descriptor.ts"
import {createExternalStorybookClientSnapshot} from "../runtime/client-protocol.ts"
import {deriveExternalStorybookPackageTab} from "../runtime/model.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"
import {storybookPackageRouteFromPathname} from "@zavx0z/storybook-browser-lifecycle/contract"

async function fixture(bound: boolean, collision = false) {
  const catalog = await resolveExternalStorybookDeclarations([join(import.meta.dir, "../discovery/fixtures/valid/standalone")])
  const scope = catalog.scopes[0]!
  if (scope.kind !== "package") throw new Error("Нужен пакет")
  const category = scope.catalog!.categories[0]!
  const subject = category.subjects[0]!
  return {...catalog, scopes: [{...scope,
    directories: [{path: join(scope.scopeRoot, "module"), relativePath: "module", name: "module", structuralRole: "module" as const, readmePath: null,
      contractDocumentation: {sources: [{sourcePath: join(scope.scopeRoot, "module/contract/input.ts"), sourceDigest: "fixture"}], documents: [{direction: "input" as const, document: {name: "Input", declarations: []}}]},
      scenarioSpec: {sourcePaths: [join(scope.scopeRoot, "module/spec/scenario.spec.ts"), join(scope.scopeRoot, "module/spec/scenario.spec.tsx")]},
      dependencySpec: {sourcePath: "deps.spec.ts", sourceDigest: "fixture", cases: []},
    }],
    catalog: {...scope.catalog!, categories: [{...category, subjects: [{...subject,
      ...(bound ? {directory: "module"} : {}),
      variants: [{id: "basic", label: "Basic", route: collision ? `${subject.route}/scenarios` : `${subject.route}/basic`, group: null, module: null, resources: [], presentation: subject.presentation, source: subject.source}],
    }]}]},
  }]}
}

test.each([false, true])("[SCENARIOS-ROUTE] присутствие файла даёт одну вкладку и собственный URL, binding=%s", async bound => {
  const catalog = await fixture(bound)
  const graph = createExternalStorybookGraph(catalog)
  const packageId = "@fixture/standalone"
  const scope = catalog.scopes[0]!
  const base = bound ? scope.catalog.categories[0]!.subjects[0]!.route : "dir-module"
  const route = resolveExternalStorybookRoute(graph, packageId, `${base}/scenarios`)
  expect(route.kind).toBe("scenarios")
  expect(route.nodeId).toBe(resolveExternalStorybookRoute(graph, packageId, base).nodeId)
  expect(storybookPackageRouteFromPathname(route.urlPath, packageId)).toBe(`${base}/scenarios`)
  const client = createExternalStorybookClientSnapshot(graph, [{packageId, declarationDigest: "fixture", moduleGraphRevision: null, candidateRevision: null, activeRevision: "active", lastGoodRevision: "active", entryRelativePath: "entry.js", diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "active", builds: 0}])
  for (const data of [graph, client]) {
    const model = deriveExternalStorybookPackageTab(data, packageId, `${base}/scenarios`)
    expect(model.tabs.slice(0, 3).map(item => item.label)).toEqual(["Зависимости", "Контракт", "Сценарии"])
    expect(model.tabs.find(item => item.id === model.tabActiveId)?.route).toBe(`${base}/scenarios`)
    expect(model.viewKind).toBe("scenarios")
    expect(model.urlPath).toBe(route.urlPath)
    expect(deriveExternalStorybookPackageTab(data, packageId, base).tabActiveId).toBeNull()
  }
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(item => item.path === `${base}/scenarios`)).toMatchObject({nodeId: route.nodeId, kind: "scenarios"})
  expect(revision.nodes.find(item => item.id === route.nodeId)?.contractDocuments?.[0]?.direction).toBe("input")
  expect(() => resolveExternalStorybookRoute(graph, packageId, "dir-missing/scenarios")).toThrow()
  const descriptor = externalStorybookPackageDescriptors(catalog, graph)[0]!
  expect(revision.nodes.find(item => item.id === route.nodeId)?.scenariosRoutePath).toBe(`${base}/scenarios`)
  const scenarioPath = join(scope.scopeRoot, "module/spec/scenario.spec.ts")
  expect(descriptor.watchPaths).toContainEqual({path: scenarioPath, category: "declaration"})
  const inputPath = join(scope.scopeRoot, "module/contract/input.ts")
  expect(descriptor.watchPaths).toContainEqual({path: inputPath, category: "declaration"})
  expect(descriptor.resourceFiles?.some(file => file.sourcePath === inputPath && file.contentDigest === "fixture" && file.derivedContent?.includes('"direction":"input"'))).toBe(true)

})

test("[SCENARIOS-COLLISION] вкладка не перекрывает авторский variant", async () => {
  const catalog = await fixture(true, true)
  expect(() => createExternalStorybookGraph(catalog)).toThrow("Duplicate normalized external Storybook route")
})

test("[SCENARIOS-ABSENT] без файла нет вкладки и маршрута", async () => {
  const catalog = await fixture(false)
  const scopes = catalog.scopes.map(scope => ({...scope, directories: scope.directories?.map(directory => {
    const {scenarioSpec, ...withoutScenario} = directory
    return withoutScenario
  })}))
  const graph = createExternalStorybookGraph({...catalog, scopes})
  const model = deriveExternalStorybookPackageTab(graph, "@fixture/standalone", "dir-module")
  expect(model.tabs.some(tab => tab.label === "Сценарии")).toBe(false)
  expect(() => resolveExternalStorybookRoute(graph, "@fixture/standalone", "dir-module/scenarios")).toThrow()
})
