import {expect, test} from "bun:test"
import createApp from "@storybook/app"
import State from "@storybook-app-server/state"
import {writeFileSync} from "node:fs"
import {join} from "node:path"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test("изменение исходников не блокирует живой сервер; перезапуск выполняется явно", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const context = () => ({signal: AbortSignal.timeout(15_000)})
  const app = createApp({toolRoot: fixture.toolRoot, daemonEntryPath: fixture.daemonEntryPath, legacyStatePaths: []})
  try {
    const first = await app.ensure({schemaVersion: 1}, context())
    const record = State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath())
    writeFileSync(join(fixture.toolRoot, "unfinished.ts"), "export const value =\n")
    expect(await app.status({schemaVersion: 1}, context())).toMatchObject({
      status: "success", server: "running", instanceId: first.instanceId,
    })
    expect(await app.ensure({schemaVersion: 1}, context())).toMatchObject({
      status: "success", server: "running", instanceId: first.instanceId,
    })
    const graph = await app.readResource("storybook://graph", context())
    expect(JSON.stringify(graph)).toContain("fixture-graph")
    expect(State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath()).pid).toBe(record.pid)

    await app.stop({schemaVersion: 1, confirm: true}, context())
    const restarted = await app.ensure({schemaVersion: 1}, context())
    expect(restarted.instanceId).not.toBe(first.instanceId)
    expect(State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath()).origin).toBe(record.origin)
  } finally {
    try { await app.stop({schemaVersion: 1, confirm: true}, context()) } finally {
      if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
      else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
      if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
      else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
      fixture.dispose()
    }
  }
}, 30_000)
