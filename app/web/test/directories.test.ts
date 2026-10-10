import createWeb from "@zavx0z/storybook-app-web"
import AppServerCatalogOwner, {type StorybookAppServerCatalog as AppServerCatalogContract} from "@zavx0z/storybook-app-server-catalog"
import PackageMetadataCollectOwner from "@zavx0z/storybook-package-metadata-collect"
const ExternalStorybookRegistry = AppServerCatalogOwner
const discoverStorybookPackages = PackageMetadataCollectOwner
type ExternalStorybookRegistry = AppServerCatalogContract.Output
import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import WebNavigationOwner from "@zavx0z/storybook-app-web-page-navigation"
const deriveExternalStorybookLanding = WebNavigationOwner.deriveExternalStorybookLanding
const deriveExternalStorybookLandingSelection = WebNavigationOwner.deriveExternalStorybookLandingSelection
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab
const deriveExternalStorybookNavigationTree = WebNavigationOwner.deriveExternalStorybookNavigationTree
import WebProtocol from "@zavx0z/storybook-app-web-protocol"
const createExternalStorybookClientSnapshot = WebProtocol.clientSnapshot
const deriveStorybookBreadcrumbs = WebNavigationOwner.deriveStorybookBreadcrumbs
import startExternalStorybookServer from "@zavx0z/storybook-app-server"
import {createProjectFixture} from "../../server/test/project.fixture"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-directory-graph-")))
  roots.push(root)
  const repo = join(root, "repo")
  await mkdir(repo)
  expect(await Bun.spawn(["git", "init", "--quiet", repo]).exited).toBe(0)
  await Bun.write(join(repo, "package.json"), JSON.stringify({name: "fixture", label: "Repository", workspaces: ["unit"]}))
  await Bun.write(join(repo, ".gitignore"), "dist/\n")
  await Bun.write(join(repo, "unit/package.json"), JSON.stringify({name: "@fixture/unit", label: "Unit"}))
  for (const path of ["docs/guide", "dist/generated", "src/hidden", "unit/docs/guide", "unit/docs/with # hash"]) await mkdir(join(repo, path), {recursive: true})
  await Bun.write(join(repo, "docs/README.md"), "# Repository documentation")
  await Bun.write(join(repo, "unit/docs/README.md"), "# Package documentation")
  await Bun.write(join(repo, "docs/index.ts"), "/**\n# Repository module\n@packageDocumentation\n*/")
  await Bun.write(join(repo, "unit/docs/index.ts"), "/**\n# Package module\n@packageDocumentation\n*/\nthrow new Error('Never execute documentation')")
  return {root, repo}
}

test("keeps packages and physical directories in the same navigation tree", async () => {
  const {repo} = await fixture()
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  const snapshot = await registry.configure([repo])
  expect(snapshot.catalog.scopes.flatMap(scope => scope.resolutionError === undefined ? [] : [scope.resolutionError])).toEqual([])
  const graph = snapshot.graph
  expect(deriveExternalStorybookLanding(graph).catalogItems.map(item => item.title)).toEqual(["Repository", "Unit"])
  const rootId = graph.rootIds[0]!
  const repository = deriveExternalStorybookLandingSelection(graph, rootId)
  expect(repository.overviewNode.id).toBe(rootId)
  const navigation = deriveExternalStorybookNavigationTree(graph)
  expect(navigation.filter(item => item.id.includes("package:fixture/docs") && item.id.startsWith("directory:")).map(item => item.label)).toEqual(["docs", "guide"])
  expect(graph.nodes.some(node => node.kind === "directory" && node.label === "guide")).toBeTrue()
  const nested = graph.nodes.find(node => node.kind === "directory" && node.packageId === "fixture" && node.label === "docs")!
  expect(deriveExternalStorybookLandingSelection(graph, nested.id).overviewNode.id).toBe(nested.id)
  const client = createExternalStorybookClientSnapshot(graph, ["fixture", "@fixture/unit"].map(packageId => ({
    packageId, declarationDigest: "fixture", moduleGraphRevision: null,
    candidateRevision: null, activeRevision: null, lastGoodRevision: null, entryRelativePath: null,
    diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "idle", builds: 0,
  })), "Fixture Project")
  expect(deriveStorybookBreadcrumbs(client, nested.id, {kind: "landing"}).map(item => item.label)).toEqual(["Fixture Project", "Repository", "docs"])
  expect(navigation.some(item => item.id.startsWith("category:") || item.id.startsWith("subject:"))).toBeFalse()
  const packageDoc = graph.nodes.find(node => node.kind === "directory" && node.packageId === "@fixture/unit" && node.label === "docs")!
  expect(deriveExternalStorybookPackageTab(graph, "@fixture/unit", packageDoc.routePath!).selectedNode.id).toBe(packageDoc.id)
  const descriptor = registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!
  expect(descriptor.graphSnapshot.nodes.some(node => node.id === nested.id)).toBeFalse()
  expect(descriptor.graphSnapshot.nodes.find(node => node.id === packageDoc.id)?.hasModuleDocumentation).toBeTrue()
  expect(descriptor.resourceFiles?.find(file => file.targetPath.endsWith("module.md"))?.derivedContent).toBe("# Package module")
  const previous = descriptor.declarationDigest
  await mkdir(join(repo, "unit/docs/another-nested-directory"))
  await registry.refresh()
  const nestedRevision = registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!.declarationDigest
  expect(nestedRevision).not.toBe(previous)
  await mkdir(join(repo, "another-repository-directory"))
  await registry.refresh()
  expect(registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!.declarationDigest).toBe(nestedRevision)
  await Bun.write(join(repo, "unit/.gitignore"), "docs/\n")
  const changed = await registry.refresh()
  expect(deriveExternalStorybookNavigationTree(changed.graph).some(item => item.id.includes("@fixture/unit") && item.label === "docs")).toBeFalse()
})

test("явный refresh обновляет обзор директории и правила gitignore", async () => {
  const {root, repo} = await fixture()
  createProjectFixture(root, [repo])
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "storybook-web-state-")))
  roots.push(stateRoot)
  const server = await startExternalStorybookServer({createWeb, project: root, statePath: join(stateRoot, "server.json"), artifactRoot: join(root, "artifacts")})
  try {
    const refresh = async () => fetch(new URL("/api/control/refresh", server.origin), {
      method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"}, body: JSON.stringify({force: true}),
    })
    const docs = server.registry.snapshot().graph.nodes.find(node => node.kind === "directory" && node.packageId === "fixture" && node.label === "docs")!
    const resource = `/__storybook/resources/nodes/${encodeURIComponent(docs.id)}/`
    expect(await (await fetch(new URL(resource, server.origin))).text()).toBe("# Repository module")
    await Bun.write(join(repo, "docs/index.ts"), "/**\n# Updated module\n@packageDocumentation\n*/")
    await refresh()
    expect(await (await fetch(new URL(resource, server.origin))).text()).toBe("# Updated module")
    await Bun.write(join(repo, ".gitignore"), "dist/\ndocs/\n")
    await refresh()
    expect(server.registry.snapshot().graph.nodes.some(node => node.id === docs.id)).toBeFalse()
    expect((await fetch(new URL(docs.urlPath, server.origin))).status).toBe(404)
  } finally { await server.stop() }
}, 60_000)
