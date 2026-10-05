import {expect, test} from "bun:test"
import {resolve} from "node:path"
import connect from "../index"

test("ACP передаёт штатные blocks и negotiated capabilities; audio без capability отклоняется", async () => {
  const updates: unknown[] = []
  const connection = await connect({
    cwd: resolve(import.meta.dir, "../../.."), command: process.execPath,
    args: [resolve(import.meta.dir, "fixture/agent.ts")], mcpServers: [],
    onUpdate: update => { updates.push(update) },
    onPermission: async () => ({outcome: {outcome: "cancelled"}}),
  })
  try {
    expect(connection.capabilities.promptCapabilities).toMatchObject({image: true, embeddedContext: true})
    const content = [{type: "text" as const, text: "content"}, {type: "image" as const, data: "AA==", mimeType: "image/png"}]
    await connection.prompt(content)
    const update = updates[0] as {content: {text: string}}
    expect(JSON.parse(update.content.text).blocks).toEqual(content)
    await expect(connection.prompt([{type: "audio", data: "AA==", mimeType: "audio/wav"}])).rejects.toThrow("не объявил поддержку audio")
  } finally { await connection.dispose() }
})

test("полная локальная история использует advertised resume; load остаётся fallback с отдельным replay", async () => {
  for (const behavior of ["resume", "load"]) {
    const replay: unknown[] = []
    const live: unknown[] = []
    const connection = await connect({
      cwd: resolve(import.meta.dir, "../../.."), command: process.execPath,
      args: [resolve(import.meta.dir, "fixture/agent.ts")], mcpServers: [],
      env: {ACP_FIXTURE_BEHAVIOR: behavior}, previousSessionId: "retained", preferResume: true,
      onReplay: update => { replay.push(update) },
      onUpdate: update => { live.push(update) },
      onPermission: async () => ({outcome: {outcome: "cancelled"}}),
    })
    try {
      expect(connection.sessionId).toBe("retained")
      expect(replay).toHaveLength(behavior === "resume" ? 0 : 1)
      expect(live).toEqual([])
      await connection.prompt("continue")
      expect(live).toHaveLength(1)
    } finally { await connection.dispose() }
  }
})
