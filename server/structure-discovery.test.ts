import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {deriveExternalStorybookLanding, deriveExternalStorybookLandingSelection} from "../runtime/model.ts"
import {startExternalStorybookServer} from "./server.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

async function write(path: string, value: unknown) {
  await mkdir(join(path, ".."), {recursive: true})
  await Bun.write(path, JSON.stringify(value))
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-structure-")))
  roots.push(root)
  const project = join(root, "project")
  await write(join(project, "package.json"), {name: "project", label: "Project", workspaces: ["packages/*"]})
  await write(join(project, ".storybook/manifest.json"), {schemaVersion: 1, kind: "project", id: "project"})
  await write(join(project, "packages/a/package.json"), {name: "@fixture/a", label: "A"})
  await write(join(project, "packages/b/package.json"), {name: "@fixture/b", label: "B"})
  return {root, project}
}

test("lists and selects packages without manifests in the repository tree", async () => {
  const {project} = await fixture()
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const snapshot = await registry.attach(project)
  const selection = deriveExternalStorybookLandingSelection(snapshot.graph, "project:project")
  expect(selection.secondaryItems.map(item => item.label)).toEqual(["packages"])
  expect(deriveExternalStorybookLanding(snapshot.graph).catalogItems.map(item => item.label)).toEqual(["Project", "A", "B"])
  expect(deriveExternalStorybookLandingSelection(snapshot.graph, "package:@fixture/b").catalogActiveId).toBe("package:@fixture/b")
  const descriptor = registry.packageDescriptors().find(value => value.packageId === "@fixture/a")!
  expect(descriptor.runtime).toBeNull()
  expect(descriptor.variants).toEqual([])
  expect(snapshot.catalog.scopes.find(scope => scope.id === "@fixture/a")?.source.path).toBe(join(project, "packages/a/package.json"))
  await rm(join(project, ".storybook"), {recursive: true})
  const structural = await registry.refresh()
  expect(structural.graph.rootIds).toEqual(["project:project"])
  expect(structural.catalog.scopes.some(scope => scope.resolutionError !== undefined)).toBeFalse()
  expect(structural.catalog.scopes.find(scope => scope.kind === "project")?.source.path).toBe(join(project, "package.json"))
  expect(structural.graph.nodes.filter(node => node.kind === "package")).toHaveLength(2)
})

test("updates optional manifests and workspace membership while preserving package identities", async () => {
  const {project} = await fixture()
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  await registry.attach(project)
  const manifest = join(project, "packages/a/.storybook/manifest.json")
  await write(manifest, {schemaVersion: 1, kind: "package", id: "@fixture/a", packageJson: "../package.json"})
  const supplemented = await registry.refresh()
  expect(supplemented.catalog.scopes.find(scope => scope.id === "@fixture/a")?.source.path).toBe(manifest)
  await Bun.write(manifest, "{")
  const failed = await registry.refresh()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/a")?.resolutionError).toBeDefined()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/b")?.resolutionError).toBeUndefined()
  await rm(manifest)
  await write(join(project, "packages/c/package.json"), {name: "@fixture/c", label: "C"})
  await rm(join(project, "packages/b"), {recursive: true})
  const changed = await registry.refresh()
  expect(changed.graph.nodes.filter(node => node.kind === "package").map(node => node.id)).toEqual(["package:@fixture/a", "package:@fixture/c"])
  expect(changed.catalog.scopes.some(scope => scope.resolutionError !== undefined)).toBeFalse()
  await registry.detach("package:@fixture/a")
  expect(registry.snapshot().graph.rootIds).toEqual(["project:fixture-c"])
  expect((await registry.refresh()).graph.rootIds).toEqual(["project:fixture-c"])
})

test("rejects conflicting composition sources and duplicate package names", async () => {
  const {project} = await fixture()
  const manifest = join(project, ".storybook/manifest.json")
  await write(manifest, {schemaVersion: 1, kind: "project", id: "project", packages: []})
  await expect(resolveExternalStorybookDeclarations([project])).rejects.toThrow("either")
  await rm(manifest)
  await write(join(project, "packages/b/package.json"), {name: "@fixture/a", label: "Other A"})
  await expect(resolveExternalStorybookDeclarations([project])).rejects.toThrow("Ambiguous")
})

test("watches structural additions and optional manifests and serves a manifest-free package", async () => {
  const {root, project} = await fixture()
  await Bun.write(join(project, "packages/a/README.md"), "# Structural A\n")
  const server = await startExternalStorybookServer({declarations: [project], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")})
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10_000
    while (!predicate() && Date.now() < deadline) await Bun.sleep(50)
    expect(predicate()).toBeTrue()
  }
  try {
    await write(join(project, "packages/c/package.json"), {name: "@fixture/c", label: "C"})
    await waitFor(() => server.registry.snapshot().graph.nodes.some(node => node.id === "package:@fixture/c"))
    const manifest = join(project, "packages/c/.storybook/manifest.json")
    await write(manifest, {schemaVersion: 1, kind: "package", id: "@fixture/c", packageJson: "../package.json"})
    await waitFor(() => server.registry.snapshot().catalog.scopes.some(scope => scope.id === "@fixture/c" && scope.source.path === manifest))
    await rm(manifest)
    await waitFor(() => server.registry.snapshot().catalog.scopes.some(scope => scope.id === "@fixture/c" && scope.source.path.endsWith("/package.json")))
    const page = await fetch(new URL("/packages/%40fixture%2Fa/", server.origin))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("external-storybook-canvas")
    expect(server.sessions.session("@fixture/a").snapshot().diagnostics).toEqual([])
  } finally {
    await server.stop()
  }
}, 120_000)

test("nested packages share navigation ancestry without sharing revision content or failure", async () => {
  const {project} = await fixture()
  await write(join(project, "package.json"), {name: "project", label: "Project", workspaces: ["packages/**"]})
  await write(join(project, "packages/a/child/package.json"), {name: "@fixture/child", label: "Child"})
  const parentManifest = join(project, "packages/a/.storybook/manifest.json")
  await write(parentManifest, {schemaVersion: 1, kind: "package", id: "@fixture/a", packageJson: "../package.json"})
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const first = await registry.attach(project)
  const child = first.graph.nodes.find(node => node.id === "package:@fixture/child")!
  expect(child.parentId).toBe("package:@fixture/a")
  const original = registry.packageDescriptors().find(value => value.packageId === "@fixture/child")!
  expect(original.graphSnapshot.nodes.every(node => node.packageId === "@fixture/child")).toBeTrue()
  expect(original.graphSnapshot.ancestors.map(ancestor => ancestor.id)).toEqual(["project:project", "package:@fixture/a"])
  await Bun.write(parentManifest, "{")
  const failed = await registry.refresh()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/a")?.resolutionError).toBeDefined()
  expect(failed.catalog.scopes.find(scope => scope.id === "@fixture/child")?.resolutionError).toBeUndefined()
  const updated = registry.packageDescriptors().find(value => value.packageId === "@fixture/child")!
  expect(updated.graphSnapshot.packageGraphDigest).toBe(original.graphSnapshot.packageGraphDigest)
})

test("repository failures retain the nested graph and diagnose its sessions without leaking parent failures", async () => {
  const {root, project} = await fixture()
  await write(join(project, "package.json"), {name: "project", label: "Project", workspaces: ["packages/**"]})
  await write(join(project, "packages/a/child/package.json"), {name: "@fixture/child", label: "Child"})
  const server = await startExternalStorybookServer({declarations: [project], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")})
  const refresh = async () => {
    const response = await fetch(new URL("/api/control/refresh", server.origin), {
      method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"}, body: "{}",
    })
    expect(response.status).toBe(200)
  }
  try {
    const projectManifest = join(project, ".storybook/manifest.json")
    await Bun.write(projectManifest, "{")
    await refresh()
    expect(server.registry.snapshot().graph.nodes.find(node => node.id === "package:@fixture/child")?.parentId).toBe("package:@fixture/a")
    expect(server.sessions.session("@fixture/child").snapshot().diagnostics[0]?.phase).toBe("resolve")
    await write(projectManifest, {schemaVersion: 1, kind: "project", id: "project"})
    await refresh()
    expect(server.sessions.session("@fixture/child").snapshot().diagnostics).toEqual([])
    await mkdir(join(project, "packages/a/.storybook"), {recursive: true})
    await Bun.write(join(project, "packages/a/.storybook/manifest.json"), "{")
    await refresh()
    expect(server.sessions.session("@fixture/a").snapshot().diagnostics[0]?.phase).toBe("resolve")
    expect(server.sessions.session("@fixture/child").snapshot().diagnostics).toEqual([])
  } finally {
    await server.stop()
  }
})
