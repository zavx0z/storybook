import createWeb from "@app/web"
import AppWebBuildOwner from "@app-web/build"
import BuildEnvironmentOwner from "@build/environment"
import RepoDiscoveryOwner from "@repo/discovery"
import AppServerCatalogOwner, {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
const discoverStorybookPackages = RepoDiscoveryOwner
const ExternalStorybookRegistry = AppServerCatalogOwner
type ExternalStorybookRegistry = AppServerCatalogContract.Output
import {afterEach, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdirSync, realpathSync, writeFileSync} from "node:fs"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {dirname, join} from "node:path"
import {tmpdir} from "node:os"
import WebNavigationOwner from "@web/navigation"
const deriveExternalStorybookLanding = WebNavigationOwner.deriveExternalStorybookLanding
const deriveExternalStorybookLandingSelection = WebNavigationOwner.deriveExternalStorybookLandingSelection
const deriveExternalStorybookNavigationTree = WebNavigationOwner.deriveExternalStorybookNavigationTree
import startExternalStorybookServer from "@app/server"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })

async function write(path: string, value: unknown) {
  await mkdir(join(path, ".."), {recursive: true})
  await Bun.write(path, JSON.stringify(value))
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-structure-")))
  roots.push(root)
  const repo = join(root, "repo")
  await write(join(repo, "package.json"), {name: "repo", label: "Repository", workspaces: ["packages/*"]})
  await write(join(repo, "packages/a/package.json"), {name: "@fixture/a", label: "A"})
  await write(join(repo, "packages/b/package.json"), {name: "@fixture/b", label: "B"})
  return {root, repo}
}

test("lists packages and physical containers from package.json/workspaces", async () => {
  const {repo} = await fixture()
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  const snapshot = await registry.attach(repo)
  expect(deriveExternalStorybookLandingSelection(snapshot.graph, "package:repo").overviewNode.id).toBe("package:repo")
  expect(deriveExternalStorybookNavigationTree(snapshot.graph).filter(item => item.parentId === "package:repo").map(item => item.label)).toContain("packages")
  expect(deriveExternalStorybookLanding(snapshot.graph).catalogItems.map(item => item.title)).toEqual(["Repository", "A", "B"])
  const descriptor = registry.packageDescriptors().find(item => item.packageId === "@fixture/a")!
  expect(descriptor.sourcePath).toBe(join(repo, "packages/a/package.json"))
  expect(descriptor.graphSnapshot.nodes.every(node => node.packageId === "@fixture/a")).toBeTrue()
})

test("README additions do not become package documentation", async () => {
  const {repo} = await fixture()
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  const before = await registry.attach(repo)
  await Bun.write(join(repo, "README.md"), "# Repository overview")
  await Bun.write(join(repo, "packages/a/README.md"), "# Package overview")
  const after = await registry.refresh()
  expect(after.graph.nodes.find(node => node.id === "package:repo")?.moduleDocumentation).toBeUndefined()
  expect(after.graph.nodes.find(node => node.id === "package:@fixture/a")?.moduleDocumentation).toBeUndefined()
  expect(after.graph).toEqual(before.graph)
})

test("workspace membership updates without changing retained package identity", async () => {
  const {repo} = await fixture()
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  await registry.attach(repo)
  await write(join(repo, "packages/c/package.json"), {name: "@fixture/c", label: "C"})
  await rm(join(repo, "packages/b"), {recursive: true})
  const changed = await registry.refresh()
  expect(changed.graph.nodes.filter(node => node.kind === "package").map(node => node.id)).toEqual([
    "package:repo", "package:@fixture/a", "package:@fixture/c",
  ])
  expect(changed.catalog.scopes.some(scope => scope.resolutionError !== undefined)).toBeFalse()
})

test("duplicate package names fail closed", async () => {
  const {repo} = await fixture()
  await write(join(repo, "packages/b/package.json"), {name: "@fixture/a", label: "Other A"})
  await expect(discoverStorybookPackages([repo])).rejects.toThrow("Duplicate package identity")
})

test("explicit refresh discovers a new workspace package and serves its structural page", async () => {
  const {root, repo} = await fixture()
  for (const directory of [root, repo]) {
    const result = Bun.spawnSync(["git", "init", "--quiet", directory])
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "Fixture Project", private: true}))
  await Bun.write(join(root, ".gitmodules"), '[submodule "repo-0"]\n\tpath = repo\n\turl = https://example.invalid/repo-0.git\n')
  await Bun.write(join(repo, "packages/a/index.ts"), "/**\n# Structural A\n@packageDocumentation\n*/\n")
  const artifactRoot = join(root, "artifacts")
  seedSharedPage(artifactRoot)
  const server = await startExternalStorybookServer({createWeb, project: root,
    statePath: join(root, "state/server.json"), artifactRoot})
  try {
    await write(join(repo, "packages/c/package.json"), {name: "@fixture/c", label: "C"})
    expect(server.registry.snapshot().graph.nodes.some(node => node.id === "package:@fixture/c")).toBeFalse()
    const refresh = await fetch(new URL("/api/control/refresh", server.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({force: true}),
    })
    expect(refresh.status).toBe(200)
    expect(server.registry.snapshot().graph.nodes.some(node => node.id === "package:@fixture/c")).toBeTrue()
    const check = await fetch(new URL("/api/control/check", server.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({scope: "@fixture/a", live: false}),
    })
    expect(check.status).toBe(200)
    const page = await fetch(new URL("/pkg-fixture-a/", server.origin))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("external-storybook-canvas")
    expect(server.sessions.session("@fixture/a").snapshot().diagnostics).toEqual([])
  } finally { await server.stop() }
}, 120_000)

/** Готовые immutable entry bytes проверяют структурную страницу без Web compiler или browser/GPU приёмки. */
function seedSharedPage(artifactRoot: string): void {
  const root = join(artifactRoot, "shared")
  const toolRoot = realpathSync(join(import.meta.dir, "../../.."))
  const bytes = "export {}\n"
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  const modules = BuildEnvironmentOwner.createModuleEntries(toolRoot, join(artifactRoot, "identity-entries"))
    .map(({specifier, sourcePath}) => ({specifier, sourcePath,
      url: `/__storybook/shared/kernel/${digest(specifier)}.js`}))
  const sources = BuildEnvironmentOwner.sourceFiles(modules)
  const paths = ["entries/page.js", "entries/bootstrap.js",
    ...modules.map(module => module.url.slice("/__storybook/shared/".length))]
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), bytes)
  }
  const identity = BuildEnvironmentOwner.identity("/__storybook/shared/entries/page.js", modules,
    digest("fixture host"), sources)
  AppWebBuildOwner.saveReceipt({root, landingEntry: paths[0]!, fallbackEntry: paths[0]!, bootstrapEntry: paths[1]!,
    browserIdentity: identity, dependencyRealpaths: sources.map(source => source.path), authorStyleSheets: [],
    artifactDigests: paths.map(path => ({path, digest: digest(bytes)}))})
}

test("nested package failure retains its previous subtree and leaves sibling healthy", async () => {
  const {repo} = await fixture()
  await write(join(repo, "package.json"), {name: "repo", label: "Repository", workspaces: ["packages/**"]})
  await write(join(repo, "packages/a/child/package.json"), {name: "@fixture/child", label: "Child"})
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  const first = await registry.attach(repo)
  const original = first.graph.nodes.find(node => node.id === "package:@fixture/child")!
  expect(original.parentId).toBe("package:@fixture/a")
  await Bun.write(join(repo, "packages/a/package.json"), "{")
  const failed = await registry.refresh()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/a")?.resolutionError).toBeDefined()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/b")?.resolutionError).toBeUndefined()
  expect(failed.graph.nodes.find(node => node.id === original.id)?.parentId).toBe(original.parentId)
})
