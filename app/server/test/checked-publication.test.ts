import {createProjectFixture} from "./project.fixture.ts"
import createWeb from "@web/release"
import {type Zavx0zStorybookBrowserLifecycle as Zavx0zStorybookBrowserLifecycleContract} from "@zavx0z/storybook-browser-lifecycle"
type StorybookBrowserLifecycle = Zavx0zStorybookBrowserLifecycleContract.Output
import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import startExternalStorybookServer from "../index.ts"
import {seedPublishedSharedAssets} from "./shared-assets.fixture.ts"

test("явный check применяет ревизию через HMR; подписки и изменения файлов сохраняют рабочую страницу", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-automatic-publication-")))
  const owner = join(root, "owner")
  await mkdir(owner)
  const packageJson = join(owner, "package.json")
  const component = join(owner, "component/index.tsx")
  await Bun.write(packageJson, JSON.stringify({name: "@fixture/automatic", label: "Automatic"}))
  await Bun.write(join(owner, "tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, include: ["**/*.ts", "**/*.tsx"]}))
  await Bun.write(component, "export function Example() { return <article /> }\n")
  seedPublishedSharedAssets(join(root, "artifacts"))
  const viewId = `storybook-view-v1_${"a".repeat(43)}`
  const staleViewId = `storybook-view-v1_${"b".repeat(43)}`
  let latest: {packageId: string, route: string, revision: string} | null = null
  const opened: string[] = []
  let checkCurrentRevision = true
  let newConsoleErrors: readonly unknown[] = []
  let leaveDuringApplication = false
  let canceledApplications = 0
  let running!: Awaited<ReturnType<typeof startExternalStorybookServer>>
  const browser: StorybookBrowserLifecycle = {
    async listViews(_origin, _signal, _packages, packageId) {
      return packageId === "@fixture/automatic"
        ? [
          ...(!checkCurrentRevision ? [{viewId: staleViewId, packageId, route: "", title: "Old page"}] : []),
          {viewId, packageId, route: "", title: "Automatic"},
        ]
        : []
    },
    async openPackage() {
      throw new Error("Автоматическое применение не должно открывать страницу заново")
    },
    async applyRevision(currentViewId, revision) {
      if (currentViewId === staleViewId) throw new Error("Старая оболочка не поддерживает HMR")
      if (leaveDuringApplication) {
        canceledApplications += 1
        throw new Error("Storybook agent bridge call failed: AbortError: Storybook view navigated to another package")
      }
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
        inPageApplied: true,
        consoleErrors: newConsoleErrors,
      }
    },
    getView() {
      return {viewId, packageId: "@fixture/automatic", route: "", title: "Automatic"}
    },
    async inspect(inspectedViewId, options) {
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
        consoleErrors: checkCurrentRevision && options?.include?.includes("console")
          ? [{level: "error", text: "Соединение было потеряно до проверки"}]
          : [],
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
    running = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64),
      project: createProjectFixture(root, [owner]),
      statePath: join(root, "state/server.json"),
      artifactRoot: join(root, "artifacts"),
      browserLifecycle: browser,
    })
    const check = async (live = true) => (await fetch(new URL("/api/control/check", running.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({scope: "@fixture/automatic", live}),
    })).json()
    expect(await check(false)).toMatchObject({ok: true})
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
      urlPath: "/automatic",
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

    expect(await check()).toMatchObject({ok: true, applied: true})
    await waitFor(() => ["active", "failed"].includes(
      running.sessions.session("@fixture/automatic").snapshot().buildState,
    ))
    const initial = running.sessions.session("@fixture/automatic").snapshot()
    expect(initial.activeRevision, JSON.stringify(initial)).not.toBeNull()
    const first = initial.activeRevision!
    expect(opened).toEqual([first])

    await Bun.write(component, 'export function Example() { return <article title="updated" /> }\n')
    await Bun.sleep(1100)
    expect(running.sessions.session("@fixture/automatic").snapshot().activeRevision).toBe(first)
    expect(await check()).toMatchObject({ok: true, applied: true})
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

    checkCurrentRevision = true
    const buildsBeforeCheck = running.sessions.session("@fixture/automatic").snapshot().builds

    expect(await check()).toMatchObject({ok: true, applied: true})
    expect(running.sessions.session("@fixture/automatic").snapshot().builds).toBe(buildsBeforeCheck)
    newConsoleErrors = [{level: "error", text: "Новая ошибка при проверке"}]
    expect(await check()).toMatchObject({ok: false, applied: false})
    expect(running.sessions.session("@fixture/automatic").snapshot().activeRevision).toBe(second)

    newConsoleErrors = []
    leaveDuringApplication = true
    await Bun.write(component, 'export function Example() { return <article title="after-navigation" /> }\n')
    await check()
    await waitFor(() => canceledApplications > 0)
    const deferred = running.sessions.session("@fixture/automatic").snapshot()
    expect(deferred.buildState).toBe("built")
    expect(deferred.builtRevision).toBeString()
    expect(deferred.failedRevision).toBeNull()
    expect(deferred.activeRevision).toBe(second)
    expect(deferred.diagnostics).toEqual([])
    leaveDuringApplication = false
    expect(await check()).toMatchObject({ok: true, applied: true})
    expect(running.sessions.session("@fixture/automatic").snapshot().activeRevision).toBe(deferred.builtRevision!)
  } finally {
    socket?.close()
    if (running !== undefined) await running.stop()
    await rm(root, {recursive: true, force: true})
  }
}, 300_000)

/** Ожидает terminal package state без запуска дополнительной server operation. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!predicate() && Date.now() < deadline) await Bun.sleep(20)
  expect(predicate()).toBeTrue()
}
