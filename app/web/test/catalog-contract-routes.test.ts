import RepoDiscoveryOwner from "@storybook-repo/discovery"
import PackageGraphCreateOwner from "@storybook-package-graph/create"
import PackageGraphReadOwner from "@storybook-package-graph/read"
import PackageBuildDescriptorOwner from "@storybook-package-build/descriptor"
import PackageRevisionOwner from "@storybook-package/revision"
const discoverStorybookPackages = RepoDiscoveryOwner
const createExternalStorybookGraph = PackageGraphCreateOwner
const resolveExternalStorybookRoute = PackageGraphReadOwner.resolve
const externalStorybookPackageDescriptors = PackageBuildDescriptorOwner
const createStorybookPackageRevisionGraphSnapshot = PackageRevisionOwner.create
import {expect, test} from "bun:test"
import {join} from "node:path"
import WebProtocol from "@storybook-app-web/protocol"
const createExternalStorybookClientSnapshot = WebProtocol.clientSnapshot
import WebNavigationOwner from "@storybook-app-web-page/navigation"
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab

const packageId = "@fixture/standalone"
const source = join(import.meta.dir, "../../../repo/discovery/fixtures/valid/standalone")

async function fixture() {
  const catalog = await discoverStorybookPackages([source])
  const scope = catalog.scopes[0]!
  const inputPath = join(scope.scopeRoot, "module/contract/input.ts")
  const scopes = [{...scope, directories: [{path: join(scope.scopeRoot, "module"), relativePath: "module", name: "module",
    structuralRole: "module" as const,
    contractDocumentation: {sources: [{sourcePath: inputPath, sourceDigest: "fixture"}],
      documents: [{direction: "input" as const, document: {name: "Input", declarations: []}}]},
  }]}]
  return {catalog: {...catalog, scopes}, inputPath}
}

test("[CONTRACT-ROUTE] structural contract is one view of its directory", async () => {
  const {catalog, inputPath} = await fixture()
  const graph = createExternalStorybookGraph(catalog)
  const route = resolveExternalStorybookRoute(graph, packageId, "dir-module/contract")
  expect(route).toMatchObject({kind: "contract", nodeId: "directory:package:@fixture/standalone/module", urlPath: "/standalone/module?view=contract"})
  const client = createExternalStorybookClientSnapshot(graph, [{packageId, declarationDigest: "fixture", moduleGraphRevision: null,
    candidateRevision: null, activeRevision: "active", lastGoodRevision: "active", entryRelativePath: "entry.js",
    diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "active", builds: 0}], "Fixture Project")
  for (const data of [graph, client]) {
    const model = deriveExternalStorybookPackageTab(data, packageId, route.path)
    expect(model.viewKind).toBe("contract")
    expect(model.tabs.map(item => item.label)).toEqual(["Обзор", "Контракт"])
    expect(model.tabs.find(item => item.id === model.tabActiveId)?.route).toBe(route.path)
  }
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(item => item.path === route.path)).toMatchObject({nodeId: route.nodeId, kind: "contract"})
  expect(revision.nodes.find(item => item.id === route.nodeId)?.contractDocuments?.[0]?.direction).toBe("input")
  const descriptor = externalStorybookPackageDescriptors(catalog, graph)[0]!
  expect(descriptor.resourceFiles?.map(file => file.sourcePath)).toContain(inputPath)
  expect(descriptor.resourceFiles?.some(file => file.sourcePath === inputPath && file.derivedContent?.includes('"direction":"input"'))).toBeTrue()
})
