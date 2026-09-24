import {expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "./server.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {discoverStorybookPackages} from "../discovery/packages.ts"

function fixture(broken = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-package-isolation-")))
  const project = join(root, "project")
  const write = (path: string, value: unknown) => {
    mkdirSync(join(path, ".."), {recursive: true})
    writeFileSync(path, JSON.stringify(value))
  }
  write(join(project, "package.json"), {name: "fixture-project", label: "Project", workspaces: ["a", "b"]})
  for (const id of ["a", "b"]) write(join(project, `${id}/package.json`), {name: `@fixture/${id}`, label: id})
  const aMetadata = join(project, "a/package.json")
  if (broken) writeFileSync(aMetadata, "{")
  return {root, project, aMetadata,
    options: {declarations: [project], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")}}
}

async function control(server: ExternalStorybookRunningServer, action: string, body: unknown = {}) {
  const response = await fetch(new URL(`/api/control/${action}`, server.origin), {
    method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
    body: JSON.stringify(body),
  })
  return {status: response.status, body: await response.json() as Record<string, unknown>}
}

test("malformed child package.json retains only its previous subtree", async () => {
  const f = fixture()
  try {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    const first = await registry.configure([f.project])
    const before = first.graph.nodes.find(node => node.id === "package:@fixture/a")!
    writeFileSync(f.aMetadata, "{")
    writeFileSync(join(f.project, "b/package.json"), JSON.stringify({name: "@fixture/b", label: "B changed"}))
    const after = await registry.refresh()
    expect(after.catalog.scopes.find(scope => scope.id === "@fixture/a")?.resolutionError).toBeDefined()
    expect(after.catalog.scopes.find(scope => scope.id === "@fixture/b")?.label).toBe("B changed")
    expect(after.graph.nodes.find(node => node.id === before.id)?.digest).toBe(before.digest)
  } finally { rmSync(f.root, {recursive: true, force: true}) }
})

test("an unavailable configured root stays registered beside a healthy package", async () => {
  const f = fixture()
  const missing = join(f.root, "temporarily-missing")
  const server = await startExternalStorybookServer({...f.options, declarations: [missing, f.project]})
  try {
    expect((await fetch(new URL("/api/health", server.origin))).status).toBe(200)
    expect(server.sessions.session("@fixture/b").snapshot().diagnostics).toEqual([])
    const unavailable = server.registry.snapshot().catalog.scopes.find(scope => scope.scopeRoot.endsWith("temporarily-missing"))
    expect(unavailable?.kind).toBe("unavailable")
    expect(unavailable?.resolutionError).toBeDefined()
    expect(server.registry.packageDescriptors().some(descriptor => descriptor.packageRoot === missing)).toBeFalse()
    expect(JSON.parse(readFileSync(join(f.root, "state/projects.json"), "utf8"))).toContain(missing)
  } finally { await server.stop(); rmSync(f.root, {recursive: true, force: true}) }
})

test("a cold invalid child does not prevent startup, landing or checking its sibling", async () => {
  const f = fixture(true)
  let server: ExternalStorybookRunningServer | undefined
  try {
    server = await startExternalStorybookServer(f.options)
    expect((await fetch(new URL("/", server.origin))).status).toBe(200)
    expect(server.registry.snapshot().catalog.scopes.find(scope => scope.scopeRoot === join(f.project, "a"))?.resolutionError).toBeDefined()
    const checked = await control(server, "check", {scope: "@fixture/b", live: false})
    expect(checked.status).toBe(200)
    expect(checked.body.ok).toBeTrue()
    writeFileSync(f.aMetadata, JSON.stringify({name: "@fixture/a", label: "A"}))
    await control(server, "refresh")
    expect(server.registry.snapshot().graph.nodes.some(node => node.id === "package:@fixture/a")).toBeTrue()
  } finally { await server?.stop(); rmSync(f.root, {recursive: true, force: true}) }
}, 120_000)

test("a broken package.json preserves the working revision while a sibling updates", async () => {
  const f = fixture()
  let server: ExternalStorybookRunningServer | undefined
  try {
    server = await startExternalStorybookServer(f.options)
    await server.sessions.ensure("@fixture/a")
    const a = server.sessions.session("@fixture/a")
    const revision = a.snapshot().builtRevision!
    const activation = a.beginActivation({revision, viewId: "test:a", route: ""})
    a.acknowledgeActivation({...activation, frameSequence: 1})
    writeFileSync(f.aMetadata, "{")
    writeFileSync(join(f.project, "b/package.json"), JSON.stringify({name: "@fixture/b", label: "Updated B"}))
    const result = await control(server, "check", {scope: "@fixture/b", live: false})
    expect(result.status).toBe(200)
    expect(result.body.ok).toBeTrue()
    expect(a.snapshot().activeRevision).toBe(revision)
    expect(a.snapshot().lastWorkingRevision).toBe(revision)
    expect(a.snapshot().buildState).toBe("failed")
    expect(a.snapshot().diagnostics[0]?.phase).toBe("resolve")
    expect(server.registry.snapshot().graph.nodes.find(node => node.id === "package:@fixture/b")?.label).toBe("Updated B")
    writeFileSync(f.aMetadata, JSON.stringify({name: "@fixture/a", label: "A"}))
    await control(server, "refresh")
    expect(a.snapshot().diagnostics).toEqual([])
  } finally { await server?.stop(); rmSync(f.root, {recursive: true, force: true}) }
}, 120_000)
