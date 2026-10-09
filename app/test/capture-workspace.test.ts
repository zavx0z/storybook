import createApp from "@zavx0z/storybook-app"
import ServerState from "@zavx0z/storybook-app-server-state"
import {expect, test} from "bun:test"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test("capture observes the selected workspace and never opens another address", async () => {
  const fixture = createLazyStartupFixture()
  const previousCwd = process.cwd()
  process.chdir(fixture.toolRoot)
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  const paths: string[] = []
  let inspections = 0
  const selected = {viewId: "selected-view", packageId: "@fixture/a", route: "component", title: "A"}
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    paths.push(path)
    if (path === "/api/health") return Response.json({ok: true})
    if (path === "/api/control/status") return Response.json({packages: []})
    if (path === "/api/control/views") return Response.json({views: [selected]})
    if (path === "/api/control/views/selected-view") return Response.json({view: selected})
    if (path === "/api/control/inspect") {
      inspections += 1
      return Response.json({ok: true, packageId: selected.packageId, route: selected.route, revision: "current", ready: inspections > 1, presented: inspections > 1})
    }
    if (path === "/api/control/wait") return Response.json({ok: true, currentRevision: "current", timeout: false})
    if (path === "/api/control/capture") {
      expect(await request.json()).toMatchObject({viewId: selected.viewId, area: "page"})
      return Response.json({ok: true, image: {mimeType: "image/png", data: "UE5H"}})
    }
    return Response.json({error: "Unexpected mutation"}, {status: 500})
  }})
  try {
    const record = ServerState.createExternalStorybookServerRecord({toolRoot: fixture.toolRoot, origin: server.url.origin})
    ServerState.writeExternalStorybookServerRecord(ServerState.externalStorybookServerStatePath(), record)
    const app = createApp({toolRoot: fixture.toolRoot, legacyStatePaths: []})
    const context = {signal: new AbortController().signal}
    await expect(app.capture({schemaVersion: 1, packageId: "@fixture/b", area: "page"}, context)).rejects.toMatchObject({code: "WORKSPACE_NOT_SELECTED"})
    await expect(app.capture({schemaVersion: 1, viewId: selected.viewId, route: "other", area: "page"}, context)).rejects.toMatchObject({code: "WORKSPACE_NOT_SELECTED"})
    expect(await app.capture({schemaVersion: 1, packageId: selected.packageId, route: selected.route, area: "page"}, context)).toMatchObject({status: "success", image: {data: "UE5H"}})
    expect(await app.wait({schemaVersion: 1, viewId: selected.viewId, condition: "presented"}, context)).toMatchObject({status: "success", reached: true})
    expect(inspections).toBe(2)
    expect(paths.filter(path => path === "/api/control/capture")).toHaveLength(1)
    expect(paths).not.toContain("/api/control/open")
  } finally {
    server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    process.chdir(previousCwd)
    fixture.dispose()
  }
})
