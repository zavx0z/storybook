import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import type {StorybookBrowserLifecycle} from "../browser-lifecycle/src/service.ts"
import {startExternalStorybookServer} from "./server.ts"

test("subscribe and watch builds apply through exact existing-page evidence", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-automatic-publication-")))
  const owner = join(root, "owner")
  await mkdir(owner)
  const packageJson = join(owner, "package.json")
  const component = join(owner, "component/index.tsx")
  await Bun.write(packageJson, JSON.stringify({name: "@fixture/automatic", label: "Automatic"}))
  await Bun.write(join(owner, "tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, include: ["**/*.ts", "**/*.tsx"]}))
  await Bun.write(component, "export function Example() { return <article /> }\n")
  const entry = join(owner, "entry.ts")
  await Bun.write(entry, "export function startExternalStorybookPackage() {}\n")
  const viewId = `storybook-view-v1_${"a".repeat(43)}`
  const staleViewId = `storybook-view-v1_${"b".repeat(43)}`
  let latest: {packageId: string, route: string, revision: string} | null = null
  const opened: string[] = []
  let running!: Awaited<ReturnType<typeof startExternalStorybookServer>>
  const browser: StorybookBrowserLifecycle = {
    async listViews(_origin, _signal, _packages, packageId) {
      return packageId === "@fixture/automatic"
        ? [
          {viewId: staleViewId, packageId, route: "", title: "Old page"},
          {viewId, packageId, route: "", title: "Automatic"},
        ]
        : []
    },
    async openPackage() {
      throw new Error("Автоматическое применение не должно открывать страницу заново")
    },
    async applyRevision(currentViewId, revision) {
      if (currentViewId === staleViewId) throw new Error("Old shell: page restart is required")
      expect(currentViewId).toBe(viewId)
      latest = {packageId: "@fixture/automatic", route: "", revision}
      opened.push(revision)
      return {
        protocol: "external-storybook-agent-bridge/1",
        packageId: "@fixture/automatic",
        route: "",
        revision,
        graphDigest: running.sessions.session("@fixture/automatic").revisionGraphSnapshot(revision)!.packageGraphDigest,
        ready: true,
        presented: true,
        timeOrigin: 1,
        frameSequence: 2,
      }
    },
    getView() {
      return {viewId, packageId: "@fixture/automatic", route: "", title: "Automatic"}
    },
    async inspect(inspectedViewId) {
      if (inspectedViewId === staleViewId) return {packageId: "@fixture/automatic", revision: "old-revision", preview: false, ready: true, presented: true}
      const loaded = latest?.revision ?? running.sessions.session("@fixture/automatic").snapshot().builtRevision
      if (loaded != null) return {
        packageId: "@fixture/automatic",
        revision: loaded,
        route: "",
        preview: false,
        ready: true,
        presented: true,
        frameSequence: 2,
        graphDigest: running.sessions.session("@fixture/automatic").revisionGraphSnapshot(loaded)!.packageGraphDigest,
        consoleErrors: [],
      }
      if (latest === null) return {packageId: "@fixture/automatic", preview: false}
      const current = latest!
      return {
        packageId: current.packageId,
        route: current.route,
        revision: current.revision,
        graphDigest: running.sessions.session(current.packageId).revisionGraphSnapshot(current.revision)!.packageGraphDigest,
        ready: true,
        presented: true,
        frameSequence: 2,
        consoleErrors: [],
      }
    },
    async interact() {
      throw new Error("unused")
    },
    async capture() {
      throw new Error("unused")
    },
    async close() {
      return {closed: false, viewId}
    },
    readCapture() {
      throw new Error("unused")
    },
  }

  let socket: WebSocket | null = null
  try {
    running = await startExternalStorybookServer({
      declarations: [owner],
      statePath: join(root, "state/server.json"),
      artifactRoot: join(root, "artifacts"),
      packageBrowserEntryPath: entry,
      browserLifecycle: browser,
    })
    const preparedResponse = await fetch(new URL("/api/browser/prepare", running.origin), {
      method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId: "@fixture/automatic", route: ""}),
    })
    const prepared = await preparedResponse.json() as Record<string, unknown>
    expect(preparedResponse.status, JSON.stringify(prepared)).toBe(200)
    expect(prepared).toMatchObject({
      protocol: "storybook-package-prepare/1",
      packageId: "@fixture/automatic",
      route: "",
      urlPath: "/pkg-fixture-automatic/",
      intent: "navigation-candidate",
      preview: false,
      initialAppliedRevision: null,
    })
    expect(prepared.readerToken).toBeString()
    expect(running.sessions.session("@fixture/automatic").snapshot().activeRevision).toBeNull()
    expect(opened).toEqual([])
    const previewResponse = await fetch(new URL("/api/browser/prepare", running.origin), {
      method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId: "@fixture/automatic", route: "", previewRevision: prepared.revision}),
    })
    const preparedPreview = await previewResponse.json() as Record<string, unknown>
    expect(preparedPreview).toMatchObject({
      revision: prepared.revision,
      intent: "preview",
      preview: true,
      initialAppliedRevision: null,
    })
    const previewEventsUrl = new URL(`/api/events?session=${encodeURIComponent(String(preparedPreview.readerToken))}`, running.origin)
    previewEventsUrl.protocol = "ws:"
    const previewSocket = new WebSocket(previewEventsUrl, {headers: {Origin: running.origin}} as never)
    try {
      await new Promise<void>(resolve => previewSocket.addEventListener("open", () => resolve(), {once: true}))
      previewSocket.send(JSON.stringify({type: "subscribe", topic: "package:@fixture/automatic"}))
      await waitFor(() => running.sessions.session("@fixture/automatic").snapshot().subscribers === 1)
      await Bun.sleep(25)
      expect(opened).toEqual([])
      expect(running.sessions.session("@fixture/automatic").snapshot().activeRevision).toBeNull()
    } finally {
      previewSocket.close()
    }
    await waitFor(() => running.sessions.session("@fixture/automatic").snapshot().subscribers === 0)
    const sessionResponse = await fetch(new URL("/api/browser/session", running.origin), {
      method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId: "@fixture/automatic", revision: null}),
    })
    const {token} = await sessionResponse.json() as {token: string}
    const eventsUrl = new URL(`/api/events?session=${encodeURIComponent(token)}`, running.origin)
    eventsUrl.protocol = "ws:"
    socket = new WebSocket(eventsUrl, {headers: {Origin: running.origin}} as never)
    await new Promise<void>(resolve => socket!.addEventListener("open", () => resolve(), {once: true}))
    socket.send(JSON.stringify({type: "subscribe", topic: "package:@fixture/automatic"}))

    await waitFor(() => ["active", "failed"].includes(
      running.sessions.session("@fixture/automatic").snapshot().buildState,
    ))
    const initial = running.sessions.session("@fixture/automatic").snapshot()
    expect(initial.activeRevision, JSON.stringify(initial)).not.toBeNull()
    const first = initial.activeRevision!
    expect(opened).toEqual([first])

    await Bun.write(entry, "export function startExternalStorybookPackage() { return 'updated' }\n")
    expect(running.watch.notify(entry)).toBeGreaterThan(0)
    await waitFor(() => {
      const snapshot = running.sessions.session("@fixture/automatic").snapshot()
      return snapshot.activeRevision !== first || snapshot.buildState === "failed"
    })
    const updated = running.sessions.session("@fixture/automatic").snapshot()
    expect(updated.activeRevision, JSON.stringify(updated)).not.toBe(first)
    const second = updated.activeRevision!
    expect(opened).toEqual([first, second])
    const waiting = await fetch(new URL("/api/control/wait", running.origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.record.controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({packageId: "@fixture/automatic", condition: "active", afterRevision: second, timeoutMs: 100}),
    })
    expect(await waiting.json()).toMatchObject({ok: false, timeout: true, currentRevision: null})
  } finally {
    socket?.close()
    if (running !== undefined) await running.stop()
    await rm(root, {recursive: true, force: true})
  }
}, 60_000)

/** Ожидает terminal package state без запуска дополнительной server operation. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!predicate() && Date.now() < deadline) await Bun.sleep(20)
  expect(predicate()).toBeTrue()
}
