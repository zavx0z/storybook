import {expect, test} from "bun:test"
import {resolve} from "node:path"
import type {SessionUpdate} from "@agentclientprotocol/sdk"
import connect from "../index"

test("настройки берутся из ACP, модель обновляет допустимое мышление, resume передаёт usage без старых сообщений", async () => {
  const updates: SessionUpdate[] = []
  const connection = await connect({
    cwd: resolve(import.meta.dir, "../../.."),
    command: process.execPath,
    args: [resolve(import.meta.dir, "fixture/agent.ts")],
    env: {ACP_FIXTURE_BEHAVIOR: "settings"},
    previousSessionId: "saved-session",
    mcpServers: [],
    onUpdate: update => { updates.push(update) },
    onPermission: async () => ({outcome: {outcome: "cancelled"}}),
  })
  try {
    expect(connection.sessionId).toBe("saved-session")
    expect(connection.configOptions.map(option => option.id)).toEqual(["model", "effort"])
    expect(updates).toEqual([{sessionUpdate: "usage_update", used: 427000, size: 828000}])
    const selected = await connection.setConfigOption("model", "model-b")
    expect(selected).toMatchObject([{currentValue: "model-b"}, {currentValue: "low", options: [{value: "low"}]}])
    expect(connection.configOptions).toEqual(selected)
    await expect(connection.setConfigOption("effort", "high")).rejects.toThrow()
    expect(connection.configOptions).toEqual(selected)
  } finally { await connection.dispose() }
})
