import {expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createExternalStorybookController} from "./controller.ts"
import {createExternalStorybookServerRecord, externalStorybookServerStatePath, writeExternalStorybookServerRecord} from "./server-state.ts"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"

test.each(["compiling", "failed", "old-failed"])("таймаут ожидания сохраняет актуальное состояние %s без повторного check", async buildState => {
  const stateRoot = mkdtempSync(join(tmpdir(), "storybook-check-wait-"))
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  let checks = 0
  let legacyStatus = false
  const viewsQueries: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/control/check") {
        checks += 1
        await new Promise<void>(resolve => {
          if (request.signal.aborted) resolve()
          else request.signal.addEventListener("abort", () => resolve(), {once: true})
        })
        return new Response(null, {status: 499})
      }
      if (path === "/api/control/status") return Response.json({
        packages: [{
          packageId: "@fixture/pending",
          buildState: checks === 0 ? buildState === "old-failed" ? "failed" : "idle" : buildState === "old-failed" ? "failed" : buildState,
          generation: buildState === "old-failed" || checks === 0 ? 1 : 2,
          failedRevision: buildState === "old-failed" ? "previous-failure" : checks > 0 && buildState === "failed" ? "new-failure" : null,
          pendingOperationId: "owned-operation", builds: 1,
        }],
        ...(legacyStatus ? {} : {preflight: {packageIds: ["@fixture/pending"]}}),
        buildScheduler: {activeCount: 1, queuedCount: 0},
        discovery: {refreshing: buildState === "old-failed"},
      })
      if (path === "/api/control/views") {
        viewsQueries.push(new URL(request.url).search)
        return Response.json({views: [{packageId: "@fixture/pending"}, {packageId: "@fixture/other"}]})
      }
      return Response.json({ok: true})
    },
  })
  try {
    const record = createExternalStorybookServerRecord({
      toolRoot: process.cwd(),
      origin: server.url.origin,
      implementationDigest: externalStorybookImplementationDigest(process.cwd()),
      attachedDeclarations: [],
    })
    writeExternalStorybookServerRecord(externalStorybookServerStatePath(), record)
    const controller = createExternalStorybookController({legacyStatePaths: []})
    const result = await controller.check({schemaVersion: 1, scope: "@fixture/pending", timeoutMs: 300}, {
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject(buildState === "old-failed"
      ? {status: "timeout", waitingOnly: true, inProgress: true, checkResultKnown: false}
      : buildState === "compiling"
      ? {status: "timeout", waitingOnly: true, inProgress: true, operationIds: ["owned-operation"]}
      : {status: "failed", waitingOnly: false, inProgress: false, operationIds: []})
    expect(result.buildScheduler).toMatchObject({activeCount: 1, queuedCount: 0})
    expect(checks).toBe(1)
    if (buildState === "compiling") {
      writeExternalStorybookServerRecord(externalStorybookServerStatePath(), {...record, implementationDigest: "0".repeat(64)})
      legacyStatus = true
      const legacy = await controller.status({schemaVersion: 1, scope: "/fixture/project", includeViews: true}, {signal: new AbortController().signal})
      expect(legacy).toMatchObject({server: "stale", running: true, scopeProjection: "unavailable"})
      expect(legacy.packages).toHaveLength(1)
      expect(legacy.views).toHaveLength(2)
      expect(viewsQueries.at(-1)).toBe("")
      legacyStatus = false
      const scoped = await controller.status({schemaVersion: 1, scope: "/fixture/project", includeViews: true}, {signal: new AbortController().signal})
      expect(scoped).toMatchObject({scopeProjection: "exact"})
      expect(scoped.views).toHaveLength(1)
    }
  } finally {
    server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    rmSync(stateRoot, {recursive: true, force: true})
  }
}, 5000)
