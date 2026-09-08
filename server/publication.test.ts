import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "./server.ts"
import type {StorybookBrowserLifecycle} from "../browser-lifecycle/src/service.ts"
import {collectUnpublishedStorybookArtifacts} from "../sessions/artifact-store.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test("publishes only after an agent check, notifies every matching tab, and restores the applied revision", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-publication-")))
  roots.push(root)
  const owner = join(root, "owner")
  await mkdir(owner)
  const other = join(root, "other")
  await mkdir(other)
  await Bun.write(join(other, "package.json"), JSON.stringify({name: "@fixture/other", label: "Other"}))
  const packageJson = join(owner, "package.json")
  await Bun.write(packageJson, JSON.stringify({name: "@fixture/applied", label: "Applied"}))
  const entry = join(root, "entry.ts")
  await Bun.write(entry, "export function startExternalStorybookPackage() {}\n")
  let server: ExternalStorybookRunningServer
  let opened = 0
  let failInspection = false
  let last: {packageId: string; route: string; revision: string} | null = null
  const viewId = `storybook-view-v1_${"a".repeat(43)}`
  const browser: StorybookBrowserLifecycle = {
    async openPackage(input) {
      opened += 1
      const revision = input.expectedRevision!
      last = {packageId: input.packageId, route: input.route, revision}
      return {
        view: {viewId, packageId: input.packageId, route: input.route, title: "Applied"},
        identity: {protocol: "external-storybook-agent-bridge/1", packageId: input.packageId, route: input.route,
          revision, graphDigest: server.sessions.session(input.packageId).revisionGraphSnapshot(revision)!.packageGraphDigest,
          ready: true, presented: true, timeOrigin: 1, frameSequence: 2},
        reused: opened > 1,
      }
    },
    async listViews() { return last ? [{viewId, packageId: last.packageId, route: last.route, title: "Applied"}] : [] },
    getView() { return {viewId, packageId: "@fixture/applied", route: "", title: "Applied"} },
    async inspect() {
      return {packageId: last!.packageId, route: last!.route, revision: last!.revision,
        graphDigest: server.sessions.session(last!.packageId).revisionGraphSnapshot(last!.revision)!.packageGraphDigest,
        ready: true, presented: true, frameSequence: 2, consoleErrors: failInspection ? ["render failed"] : []}
    },
    async interact() { throw new Error("unused") },
    async capture() { throw new Error("unused") },
    async close() { return {closed: false, viewId} },
    readCapture() { throw new Error("unused") },
  }
  const options = {declarations: [owner, other], statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts"),
    packageBrowserEntryPath: entry, browserLifecycle: browser}
  server = await startExternalStorybookServer(options)
  const tabs: WebSocket[] = []
  const control = async (live: boolean) => {
    const response = await fetch(new URL("/api/control/check", server.origin), {
      method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({scope: "@fixture/applied", live}),
    })
    expect(response.status).toBe(200)
    return await response.json() as {ok: boolean}
  }
  const readPage = async (preview?: string) => {
    const url = new URL("/packages/%40fixture%2Fapplied/", server.origin)
    if (preview) url.searchParams.set("preview", preview)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    return await response.text()
  }
  const connect = async (html: string, packageId = "@fixture/applied") => {
    const token = html.match(/name="external-storybook-browser-session" content="([^"]+)"/)![1]!
    const events: {type: string; revision?: string | null}[] = []
    const url = new URL(`/api/events?session=${token}`, server.origin)
    url.protocol = "ws:"
    const socket = new WebSocket(url, {headers: {Origin: server.origin}} as never)
    tabs.push(socket)
    socket.addEventListener("message", event => events.push(JSON.parse(String(event.data))))
    await new Promise<void>(resolve => socket.addEventListener("open", () => {
      socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
      resolve()
    }))
    return events
  }
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 5_000
    while (!predicate() && Date.now() < until) await Bun.sleep(20)
    expect(predicate()).toBeTrue()
  }
  try {
    expect((await control(false)).ok).toBeTrue()
    const first = server.sessions.session("@fixture/applied").snapshot().builtRevision!
    expect(server.sessions.session("@fixture/applied").snapshot().activeRevision).toBeNull()
    expect(opened).toBe(0)
    const unpublished = await readPage()
    expect(unpublished).toContain("/__storybook/shared/")
    expect(await readPage(first)).toContain(`/__storybook/revisions/%40fixture%2Fapplied/${first}/`)
    expect(server.sessions.session("@fixture/applied").snapshot().activeRevision).toBeNull()
    const a = await connect(unpublished)
    const b = await connect(await readPage())
    const otherSession = await fetch(new URL("/api/browser/session", server.origin), {
      method: "POST", headers: {origin: server.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId: "@fixture/other", revision: null}),
    })
    expect(otherSession.status).toBe(200)
    const {token: otherToken} = await otherSession.json() as {token: string}
    const otherEvents = await connect(`<meta name="external-storybook-browser-session" content="${otherToken}">`, "@fixture/other")
    expect((await control(true)).ok).toBeTrue()
    await waitFor(() => [a, b].every(events => events.some(event => event.type === "package.updated" && event.revision === first)))
    expect(await readPage()).toContain(`/__storybook/revisions/%40fixture%2Fapplied/${first}/`)
    await Bun.write(packageJson, JSON.stringify({name: "@fixture/applied", label: "Changed"}))
    expect((await control(false)).ok).toBeTrue()
    const second = server.sessions.session("@fixture/applied").snapshot().builtRevision!
    expect(second).not.toBe(first)
    expect(await readPage()).toContain(`/__storybook/revisions/%40fixture%2Fapplied/${first}/`)
    expect([a, b].every(events => !events.some(event => event.type === "package.updated" && event.revision === second))).toBeTrue()
    failInspection = true
    expect((await control(true)).ok).toBeFalse()
    expect(server.sessions.session("@fixture/applied").snapshot().activeRevision).toBe(first)
    failInspection = false
    expect((await control(true)).ok).toBeTrue()
    const applied = server.sessions.session("@fixture/applied").snapshot().activeRevision!
    await waitFor(() => [a, b].every(events => events.some(event => event.type === "package.updated" && event.revision === applied)))
    expect(otherEvents.some(event => event.type === "package.updated")).toBeFalse()
    for (const tab of tabs.splice(0)) tab.close()
    await server.stop()
    const orphan = join(root, "artifacts/orphan/old/entry.js")
    await Bun.write(orphan, "orphan")
    collectUnpublishedStorybookArtifacts(options.artifactRoot)
    expect(await Bun.file(orphan).exists()).toBeFalse()
    server = await startExternalStorybookServer(options)
    expect(server.sessions.session("@fixture/applied").snapshot().activeRevision).toBe(applied)
    expect(await readPage()).toContain(`/__storybook/revisions/%40fixture%2Fapplied/${applied}/`)
    expect(server.sessions.session("@fixture/applied").snapshot().builds).toBe(0)
    const synced = await connect(await readPage())
    await waitFor(() => synced.some(event => event.type === "package.applied-state" && event.revision === applied))
  } finally {
    for (const tab of tabs) tab.close()
    await server.stop()
  }
}, 120_000)
