import {expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createApp from "@zavx0z/storybook-app"
import State from "@zavx0z/storybook-app-server-state"

test("MCP status читает последнюю фактическую стадию при неответившем HTTP, без признания сборки готовой", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-progress-status-"))
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  Bun.env.STORYBOOK_STATE_ROOT = root
  const blocked = Promise.withResolvers<Response>()
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => blocked.promise})
  try {
    const record = State.createExternalStorybookServerRecord({toolRoot: process.cwd(), origin: server.url.origin})
    State.writeExternalStorybookServerRecord(State.externalStorybookServerStatePath(), record)
    const event = {type: "catalog.progress", state: "running"}
    State.writeExternalStorybookOperationProgress(record, event)
    const result = await createApp({toolRoot: process.cwd(), legacyStatePaths: []}).status({schemaVersion: 1}, {signal: new AbortController().signal})
    expect(result).toMatchObject({status: "success", server: "stale", lastObservedProgress: {event, observedAt: expect.any(Number)}})
    expect(result.reason).toContain("health request failed")
    expect(result).not.toHaveProperty("applied")
    expect(State.readExternalStorybookOperationProgress({...record, instanceId: "different-daemon"})).toBeNull()
    State.writeExternalStorybookOperationProgress(record, {type: "build.progress", phase: "bundle", state: "running", packageId: "@fixture/node"})
    expect(State.readExternalStorybookOperationProgress(record)?.event).toMatchObject({type: "build.progress", phase: "bundle", packageId: "@fixture/node"})
  } finally {
    blocked.resolve(new Response("closed"))
    await server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    rmSync(root, {recursive: true, force: true})
  }
}, 10000)
