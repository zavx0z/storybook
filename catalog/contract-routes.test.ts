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
      dependencySpec: {sourcePath: "deps.spec.ts", sourceDigest: "fixture", cases: []},
    }],
    catalog: {...scope.catalog!, categories: [{...category, subjects: [{...subject,
      ...(bound ? {directory: "module"} : {}),
      variants: [{id: "basic", label: "Basic", route: collision ? `${subject.route}/contract` : `${subject.route}/basic`, group: null, module: null, resources: [], presentation: subject.presentation, source: subject.source}],
    }]}]},
  }]}
}

test.each([false, true])("[CONTRACT-ROUTE] один владелец и вкладка после зависимостей, binding=%s", async bound => {
  const catalog = await fixture(bound)
  const graph = createExternalStorybookGraph(catalog)
  const packageId = "@fixture/standalone"
  const scope = catalog.scopes[0]!
  const base = bound ? scope.catalog.categories[0]!.subjects[0]!.route : "dir-module"
  const route = resolveExternalStorybookRoute(graph, packageId, `${base}/contract`)
  expect(route.kind).toBe("contract")
  expect(route.nodeId).toBe(resolveExternalStorybookRoute(graph, packageId, base).nodeId)
  expect(storybookPackageRouteFromPathname(route.urlPath, packageId)).toBe(`${base}/contract`)
  const client = createExternalStorybookClientSnapshot(graph, [{packageId, declarationDigest: "fixture", moduleGraphRevision: null, candidateRevision: null, activeRevision: "active", lastGoodRevision: "active", entryRelativePath: "entry.js", diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "active", builds: 0}])
  for (const data of [graph, client]) {
    const model = deriveExternalStorybookPackageTab(data, packageId, `${base}/contract`)
    expect(model.tabs.slice(0, 2).map(item => item.label)).toEqual(["Зависимости", "Контракт"])
    expect(model.tabs.find(item => item.id === model.tabActiveId)?.route).toBe(`${base}/contract`)
    expect(model.viewKind).toBe("contract")
    expect(model.urlPath).toBe(route.urlPath)
    expect(deriveExternalStorybookPackageTab(data, packageId, base).tabActiveId).toBeNull()
  }
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(item => item.path === `${base}/contract`)).toMatchObject({nodeId: route.nodeId, kind: "contract"})
  expect(revision.nodes.find(item => item.id === route.nodeId)?.contractDocuments?.[0]?.direction).toBe("input")
  expect(() => resolveExternalStorybookRoute(graph, packageId, "dir-missing/contract")).toThrow()
  const descriptor = externalStorybookPackageDescriptors(catalog, graph)[0]!
  const inputPath = join(scope.scopeRoot, "module/contract/input.ts")
  expect(descriptor.watchPaths).toContainEqual({path: inputPath, category: "declaration"})
  expect(descriptor.resourceFiles?.some(file => file.sourcePath === inputPath && file.contentDigest === "fixture" && file.derivedContent?.includes('"direction":"input"'))).toBe(true)

})

test("[CONTRACT-COLLISION] вкладка не перекрывает авторский variant", async () => {
  const catalog = await fixture(true, true)
  expect(() => createExternalStorybookGraph(catalog)).toThrow("Duplicate normalized external Storybook route")
})
