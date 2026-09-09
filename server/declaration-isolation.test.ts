import {expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "./server.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"

function fixture(broken = false) {
  const root = mkdtempSync(join(tmpdir(), "storybook-declaration-isolation-"))
  const project = join(root, "project")
  const write = (path: string, value: unknown) => {
    mkdirSync(join(path, ".."), {recursive: true})
    writeFileSync(path, JSON.stringify(value))
  }
  write(join(project, "package.json"), {name: "fixture-project", label: "Project"})
  write(join(project, ".storybook/manifest.json"), {
    schemaVersion: 1, kind: "project", id: "isolation",
    packages: ["a", "b"].map(id => ({declaration: `../${id}/.storybook/manifest.json`})),
  })
  for (const id of ["a", "b"]) {
    write(join(project, id, "package.json"), {name: `@fixture/${id}`, label: id})
    write(join(project, id, ".storybook/manifest.json"), {
      schemaVersion: 1, ...(id === "a" ? {catalog: "./catalog.json"} : {}),
    })
  }
  write(join(project, "a/.storybook/catalog.json"), {
    schemaVersion: 1, categories: [{id: "api", label: "API", subjects: [{
      id: "contract", kind: "contract", label: "Contract",
      presentation: {protocol: "story-presentation/1", projection: "display", widgets: ["source", "diagnostics"]},
      variants: [{id: "example", label: "Example", resources: {tests: ["../selection-stories.test.ts"]}}],
    }]}],
  })
  const resource = join(project, "a/selection-stories.test.ts")
  if (!broken) writeFileSync(resource, "export {}\n")
  return {root, project, resource, options: {declarations: [project], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")}}
}

async function control(server: ExternalStorybookRunningServer, action: string, body: unknown = {}) {
  const response = await fetch(new URL(`/api/control/${action}`, server.origin), {
    method: "POST", headers: {"authorization": `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
    body: JSON.stringify(body),
  })
  return {status: response.status, body: await response.json() as Record<string, unknown>}
}

test("malformed package JSON declarations retain only their own previous subtree", async () => {
  const f = fixture()
  try {
    const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
    await registry.configure([f.project])
    const descriptor = registry.packageDescriptors().find(value => value.packageId === "@fixture/a")
    writeFileSync(join(f.project, "a/.storybook/manifest.json"), "{")
    writeFileSync(join(f.project, "b/package.json"), JSON.stringify({name: "@fixture/b", label: "B changed"}))
    const next = await registry.refresh()
    expect(next.catalog.scopes.find(value => value.id === "@fixture/a")?.resolutionError).toBeDefined()
    expect(next.catalog.scopes.find(value => value.id === "@fixture/b")?.label).toBe("B changed")
    expect(registry.packageDescriptors().find(value => value.packageId === "@fixture/a")).toBe(descriptor)
    const cold = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
    await cold.configure([f.project])
    expect(cold.snapshot().catalog.scopes.find(value => value.id === "@fixture/a")?.resolutionError).toBeDefined()
    expect(cold.snapshot().catalog.scopes.find(value => value.id === "@fixture/b")?.label).toBe("B changed")
  } finally { rmSync(f.root, {recursive: true, force: true}) }
})

test("an unavailable configured repository remains registered without blocking healthy roots", async () => {
  const f = fixture()
  const missing = join(f.root, "temporarily-missing")
  const server = await startExternalStorybookServer({...f.options, declarations: [missing, f.project]})
  try {
    expect((await fetch(new URL("/api/health", server.origin))).status).toBe(200)
    expect(server.sessions.session("@fixture/b").snapshot().diagnostics).toEqual([])
    const unavailable = server.registry.snapshot().catalog.scopes.find(scope => scope.scopeRoot.endsWith("temporarily-missing"))
    expect(unavailable?.resolutionError).toBeDefined()
    expect(unavailable?.kind).toBe("unavailable")
    expect(server.registry.packageDescriptors().some(descriptor => descriptor.packageRoot === missing)).toBeFalse()
    expect(JSON.parse(readFileSync(join(f.root, "state/projects.json"), "utf8"))).toContain(missing)
  } finally {
    await server.stop()
    rmSync(f.root, {recursive: true, force: true})
  }
})

test("a cold invalid package does not prevent startup, landing or checking its sibling", async () => {
  const f = fixture(true)
  let server: ExternalStorybookRunningServer | undefined
  try {
    server = await startExternalStorybookServer(f.options)
    expect((await fetch(new URL("/", server.origin))).status).toBe(200)
    const a = server.sessions.session("@fixture/a").snapshot()
    expect(a.buildState).toBe("failed")
    expect(a.diagnostics[0]?.message).toContain("selection-stories.test.ts")
    const b = await control(server, "check", {scope: "@fixture/b", live: false})
    expect(b.status).toBe(200)
    expect(b.body.ok).toBeTrue()
    const failed = await control(server, "check", {scope: "@fixture/a", live: false})
    expect(failed.status).toBe(200)
    expect(failed.body.ok).toBeFalse()
    writeFileSync(f.resource, "export {}\n")
    const deadline = Date.now() + 10_000
    while (server.sessions.session("@fixture/a").snapshot().diagnostics.length > 0 && Date.now() < deadline) await Bun.sleep(25)
    expect(server.sessions.session("@fixture/a").snapshot().diagnostics).toEqual([])
    expect(server.registry.snapshot().graph.nodes.some(node => node.id.endsWith("/api/contract/example"))).toBeTrue()
  } finally {
    await server?.stop()
    rmSync(f.root, {recursive: true, force: true})
  }
}, 120_000)

test("a broken declaration preserves the working revision while another agent updates a sibling", async () => {
  const f = fixture()
  let server: ExternalStorybookRunningServer | undefined
  try {
    server = await startExternalStorybookServer(f.options)
    await server.sessions.ensure("@fixture/a")
    const a = server.sessions.session("@fixture/a")
    const revision = a.snapshot().builtRevision!
    const activation = a.beginActivation({revision, viewId: "test:a", route: ""})
    a.acknowledgeActivation({...activation, revision, route: "", frameSequence: 1})
    unlinkSync(f.resource)
    writeFileSync(join(f.project, "b/package.json"), JSON.stringify({name: "@fixture/b", label: "Updated B"}))
    const result = await control(server, "check", {scope: "@fixture/b", live: false})
    expect(result.status).toBe(200)
    expect(result.body.ok).toBeTrue()
    expect(a.snapshot().activeRevision).toBe(revision)
    expect(a.snapshot().lastWorkingRevision).toBe(revision)
    expect(a.snapshot().buildState).toBe("failed")
    expect(a.snapshot().diagnostics[0]?.phase).toBe("resolve")
    expect(server.registry.snapshot().graph.nodes.find(node => node.id === "package:@fixture/b")?.label).toBe("Updated B")
    expect((await fetch(new URL("/projects/isolation/", server.origin))).status).toBe(200)
    expect(readFileSync(join(f.root, "state/projects.json"), "utf8")).toContain("project")
    writeFileSync(f.resource, "export {}\n")
    await control(server, "refresh")
    expect(a.snapshot().diagnostics).toEqual([])
  } finally {
    await server?.stop()
    rmSync(f.root, {recursive: true, force: true})
  }
}, 120_000)
