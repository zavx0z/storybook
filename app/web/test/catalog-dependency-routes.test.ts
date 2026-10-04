import RouteUrlOwner from "@zavx0z/storybook-package-route-url"
const storybookPackageRouteFromPathname = RouteUrlOwner.storybookPackageRouteFromPathname
const storybookPackageUrlPath = RouteUrlOwner.storybookPackageUrlPath
import RepoDiscoveryOwner from "@zavx0z/storybook-repo-discovery"
import PackageGraphCreateOwner from "@zavx0z/storybook-package-graph-create"
import PackageGraphReadOwner from "@zavx0z/storybook-package-graph-read"
import PackageRevisionOwner from "@zavx0z/storybook-package-revision"
const discoverStorybookPackages = RepoDiscoveryOwner
const createExternalStorybookGraph = PackageGraphCreateOwner
const externalStorybookRoutes = PackageGraphReadOwner.routes
const resolveExternalStorybookRoute = PackageGraphReadOwner.resolve
const createStorybookPackageRevisionGraphSnapshot = PackageRevisionOwner.create
import {expect, test} from "bun:test"
import {join} from "node:path"
import WebProtocol from "@zavx0z/storybook-app-web-protocol"
const createExternalStorybookClientSnapshot = WebProtocol.clientSnapshot
import WebNavigationOwner from "@zavx0z/storybook-app-web-page-navigation"
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab

const packageId = "@fixture/standalone"

async function fixture() {
  const catalog = await discoverStorybookPackages([join(import.meta.dir, "../../../repo/discovery/fixtures/valid/standalone")])
  const scope = catalog.scopes[0]!
  const scopes = [{...scope, directories: [{path: join(scope.scopeRoot, "module"), relativePath: "module", name: "module",
    structuralRole: "module" as const,
    dependencySpec: {sourcePath: join(scope.scopeRoot, "module/spec/deps.spec.ts"), sourceDigest: "fixture", cases: []},
  }]}]
  return {...catalog, scopes}
}

test("Dependencies is one view of its structural directory", async () => {
  const graph = createExternalStorybookGraph(await fixture())
  const path = "dir-module/dependencies"
  const route = resolveExternalStorybookRoute(graph, packageId, path)
  expect(route).toMatchObject({kind: "dependencies", nodeId: "directory:package:@fixture/standalone/module", urlPath: "/standalone/module?view=dependencies"})
  const client = createExternalStorybookClientSnapshot(graph, [{packageId, declarationDigest: "fixture", moduleGraphRevision: null,
    candidateRevision: null, activeRevision: "active", lastGoodRevision: "active", entryRelativePath: "entry.js",
    diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "active", builds: 0}], "Fixture Project")
  for (const data of [graph, client]) {
    const model = deriveExternalStorybookPackageTab(data, packageId, path)
    expect(model.viewKind).toBe("dependencies")
    expect(model.tabs.map(tab => tab.label)).toEqual(["Обзор", "Зависимости"])
    expect(model.tabs.find(tab => tab.id === model.tabActiveId)?.route).toBe(path)
  }
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(item => item.path === path)).toMatchObject({nodeId: route.nodeId, kind: "dependencies"})
  expect(externalStorybookRoutes(graph).filter(item => item.path === path)).toHaveLength(1)
  expect(() => resolveExternalStorybookRoute(graph, packageId, "dir-missing/dependencies")).toThrow()
})

test("only terminal Dependencies is accepted by the browser route contract", () => {
  expect(storybookPackageUrlPath("@fixture/a", "dir-category/dir-module/dependencies"))
    .toBe("/pkg-fixture-a/dir-category/dir-module/dependencies")
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dir-module/dependencies", "@fixture/a"))
    .toBe("dir-category/dir-module/dependencies")
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dependencies/dir-module", "@fixture/a")).toBeNull()
  expect(storybookPackageRouteFromPathname("/pkg-fixture-a/dir-category/dir-dependencies", "@fixture/a"))
    .toBe("dir-category/dir-dependencies")
})
