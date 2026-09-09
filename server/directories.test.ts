import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {deriveExternalStorybookLanding, deriveExternalStorybookLandingSelection, deriveExternalStorybookPackageTab, deriveExternalStorybookPackageContents} from "../runtime/model.ts"
import {createExternalStorybookClientSnapshot} from "../runtime/client-protocol.ts"
import {deriveStorybookBreadcrumbs} from "../runtime/breadcrumbs.ts"
import {startExternalStorybookServer, externalStorybookStructuralWatchPaths} from "./server.ts"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-directory-graph-")))
  roots.push(root)
  const project = join(root, "project")
  await mkdir(project)
  expect(await Bun.spawn(["git", "init", "--quiet", project]).exited).toBe(0)
  await Bun.write(join(project, "package.json"), JSON.stringify({name: "fixture", label: "Repository", workspaces: ["unit"]}))
  await Bun.write(join(project, ".gitignore"), "dist/\n")
  await Bun.write(join(project, "unit/package.json"), JSON.stringify({name: "@fixture/unit", label: "Unit"}))
  await Bun.write(join(project, "unit/.storybook/manifest.json"), JSON.stringify({schemaVersion: 1, kind: "package", id: "@fixture/unit", packageJson: "../package.json", catalog: "./catalog.json"}))
  await Bun.write(join(project, "unit/.storybook/catalog.json"), JSON.stringify({schemaVersion: 1, categories: [{id: "contract", label: "Contract", group: {id: "authored", label: "Authored"}, subjects: [{id: "document", kind: "document", label: "Document", presentation: {protocol: "story-presentation/1", projection: "display", widgets: ["source", "diagnostics"]}, variants: []}]}]}))
  for (const path of ["docs/guide", "dist/generated", "src/hidden", "unit/docs/guide", "unit/docs/with # hash"]) await mkdir(join(project, path), {recursive: true})
  await Bun.write(join(project, "docs/README.md"), "# Repository documentation")
  await Bun.write(join(project, "unit/docs/README.md"), "# Package documentation")
  await Bun.write(join(project, "docs/index.ts"), "/**\n# Repository module\n@packageDocumentation\n*/")
  await Bun.write(join(project, "unit/docs/index.ts"), "/**\n# Package module\n@packageDocumentation\n*/\nthrow new Error('Never execute documentation')")
  return {root, project}
}

test("keeps packages in the primary tree and adds immediate directories beside authored package contents", async () => {
  const {project} = await fixture()
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const snapshot = await registry.configure([project])
  expect(snapshot.catalog.scopes.flatMap(scope => scope.resolutionError === undefined ? [] : [scope.resolutionError])).toEqual([])
  const graph = snapshot.graph
  expect(deriveExternalStorybookLanding(graph).catalogItems.map(item => item.label)).toEqual(["Repository", "Unit"])
  const rootId = graph.rootIds[0]!
  const repository = deriveExternalStorybookLandingSelection(graph, rootId)
  expect(repository.secondaryItems.map(item => item.label)).toEqual(["docs"])
  expect(graph.nodes.some(node => node.kind === "directory" && node.label === "guide")).toBeFalse()
  const nested = graph.nodes.find(node => node.kind === "directory" && node.packageId === "fixture" && node.label === "docs")!
  expect(deriveExternalStorybookLandingSelection(graph, nested.id)).toMatchObject({catalogActiveId: rootId, secondaryActiveId: nested.id})
  const client = createExternalStorybookClientSnapshot(graph, ["fixture", "@fixture/unit"].map(packageId => ({
    packageId, declarationDigest: "fixture", moduleGraphRevision: null,
    candidateRevision: null, activeRevision: null, lastGoodRevision: null, entryRelativePath: null,
    diagnostics: [], dependencyRealpaths: [], subscribers: 0, buildState: "idle", builds: 0,
  })))
  expect(deriveStorybookBreadcrumbs(client, nested.id, {kind: "landing"}).map(item => item.label)).toEqual(["Главная", "Repository", "docs"])
  const contents = deriveExternalStorybookPackageContents(graph, "@fixture/unit")
  expect(contents.slice(0, 2).map(item => [item.label, item.group?.label ?? null])).toEqual([["Contract", "Authored"], ["Document", null]])
  const packageDoc = graph.nodes.find(node => node.kind === "directory" && node.packageId === "@fixture/unit" && node.label === "docs")!
  expect(deriveExternalStorybookPackageTab(graph, "@fixture/unit", packageDoc.routePath!).selectedNode.id).toBe(packageDoc.id)
  const descriptor = registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!
  expect(descriptor.graphSnapshot.nodes.some(node => node.id === nested.id)).toBeFalse()
  expect(descriptor.graphSnapshot.nodes.find(node => node.id === packageDoc.id)?.hasReadme).toBeFalse()
  expect(descriptor.graphSnapshot.nodes.find(node => node.id === packageDoc.id)?.hasModuleDocumentation).toBeTrue()
  expect(descriptor.resourceFiles?.find(file => file.targetPath.endsWith("module.md"))?.derivedContent).toBe("# Package module")
  const previous = descriptor.declarationDigest
  await mkdir(join(project, "unit/docs/another-nested-directory"))
  await registry.refresh()
  expect(registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!.declarationDigest).toBe(previous)
  await mkdir(join(project, "another-repository-directory"))
  await registry.refresh()
  expect(registry.packageDescriptors().find(descriptor => descriptor.packageId === "@fixture/unit")!.declarationDigest).toBe(previous)
  await Bun.write(join(project, "unit/.gitignore"), "docs/\n")
  const changed = await registry.refresh()
  expect(deriveExternalStorybookPackageContents(changed.graph, "@fixture/unit").some(item => item.label === "docs")).toBeFalse()
  expect(externalStorybookStructuralWatchPaths(changed)).toContain(join(project, "unit/.gitignore"))
})

test("serves a directory overview and follows gitignore changes through the existing watcher", async () => {
  const {root, project} = await fixture()
  const server = await startExternalStorybookServer({declarations: [project], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")})
  try {
    const docs = server.registry.snapshot().graph.nodes.find(node => node.kind === "directory" && node.packageId === "fixture" && node.label === "docs")!
    const page = await fetch(new URL(docs.urlPath, server.origin))
    expect(page.status).toBe(200)
    expect((await fetch(new URL("/pkg-fixture-unit/dir-docs/dir-guide", server.origin))).status).toBe(404)
    const legacyPath = "/projects/" + (server.registry.snapshot().catalog.scopes.find(scope => scope.id === "fixture")?.legacyUrls?.[0]?.split("/")[2] ?? "fixture") + "/~directories/docs/"
    const redirected = await fetch(new URL(legacyPath, server.origin), {redirect: "manual"})
    expect(redirected.status).toBe(308)
    expect(redirected.headers.get("location")).toBe(docs.urlPath)
    const resource = `/__storybook/resources/nodes/${encodeURIComponent(docs.id)}/`
    expect(await (await fetch(new URL(resource, server.origin))).text()).toBe("# Repository module")
    await Bun.write(join(project, "docs/index.ts"), "/**\n# Updated module\n@packageDocumentation\n*/")
    const refreshed = Date.now() + 10_000
    while (server.registry.snapshot().graph.nodes.find(node => node.id === docs.id)?.moduleDocumentation?.markdown !== "# Updated module" && Date.now() < refreshed) await Bun.sleep(50)
    expect(await (await fetch(new URL(resource, server.origin))).text()).toBe("# Updated module")
    await Bun.write(join(project, ".gitignore"), "dist/\ndocs/\n")
    const until = Date.now() + 10_000
    while (server.registry.snapshot().graph.nodes.some(node => node.id === docs.id) && Date.now() < until) await Bun.sleep(50)
    expect(server.registry.snapshot().graph.nodes.some(node => node.id === docs.id)).toBeFalse()
    expect((await fetch(new URL(docs.urlPath, server.origin))).status).toBe(404)
  } finally { await server.stop() }
}, 60_000)
