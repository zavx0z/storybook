import {expect, test} from "bun:test"
import {mkdir, mkdtemp, readFile, rename, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"
import {openArchive} from "../src/archive"
import {chatFile} from "../src/storage"
import {ownerCwd} from "../src/document"
import {readMoveIntent, writeMoveIntent} from "../src/relocation"
import {inspect} from "./inspect"

test("два переноса всего дерева сохраняют беседу, медиа, очередь и native identity без перепривязки", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-portability-"))
  let project = join(root, "first")
  let sessions: StorybookChatSession.Output | undefined
  const connected: {cwd: string, previousSessionId: string | undefined}[] = []
  const delivered: unknown[] = []
  const image = {type: "image" as const, mimeType: "image/png", data: "AQID"}
  const owner = () => join(project, "repo/component")
  const file = () => chatFile(join(owner(), "meta/chat"), "/repo/component")
  const create = () => createSessions({
    directory: subject => join(subject.cwd, "meta/chat"),
    resolve: address => ({address, label: "Component", cwd: owner()}),
    async connect(input) {
      connected.push({cwd: input.subject.cwd, previousSessionId: input.previousSessionId})
      return {
        sessionId: input.previousSessionId ?? "retained-native-session", capabilities: {promptCapabilities: {image: true}}, configOptions: [],
        async setConfigOption() {return []},
        async prompt(content) {
          delivered.push(content)
          await input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Готово"}})
          return {stopReason: "end_turn" as const}
        },
        async cancel() {}, async dispose() {},
      }
    },
  })
  const settled = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await sessions!.read("/repo/component")
      if (state.status === "failed") throw new Error(state.error ?? "failed")
      if (state.status === "idle" && state.pending.length === 0) return state
      await Bun.sleep(5)
    }
    throw new Error("Сессия не завершилась")
  }
  try {
    await mkdir(owner(), {recursive: true})
    sessions = create()
    await sessions.prompt("/repo/component", [image], "first-image")
    const initial = await settled()
    await sessions.dispose()
    // Проверить совместимость с существующей историей, сохранившей абсолютный cwd.
    const header = JSON.parse(await readFile(file(), "utf8"))
    const archive = await openArchive(file(), header.metadata)
    await archive.commit({...archive.metadata, cwd: owner()})
    await archive.dispose()
    const roots = [owner()]
    for (const next of ["second", "third"]) {
      const destination = join(root, next)
      await rename(project, destination)
      project = destination
      roots.push(owner())
      sessions = create()
      const before = await sessions.read("/repo/component")
      expect(before.id).toBe(initial.id)
      expect(before.executorId).toBe(initial.executorId)
      await sessions.prompt("/repo/component", [image, {type: "text", text: next}], next)
      await settled()
      await sessions.dispose()
      const stored = JSON.parse(await readFile(file(), "utf8"))
      expect(stored.metadata.cwd).toBe(".")
      expect(stored.metadata.sessionId).toBe("retained-native-session")
      const reopened = await openArchive(file(), stored.metadata)
      try {
        expect(await reopened.media.materialize(reopened.content("user:first-image"))).toEqual([image])
      } finally {await reopened.dispose()}
    }
    expect(connected).toEqual(roots.map((cwd, index) => ({cwd, previousSessionId: index ? "retained-native-session" : undefined})))
    expect(delivered).toEqual([[image], [image, {type: "text", text: "second"}], [image, {type: "text", text: "third"}]])
    sessions = create()
    const history = await inspect(sessions, "/repo/component")
    expect(history.timeline.filter(item => item.kind === "message" && item.role === "assistant")).toHaveLength(3)
    expect(history.pending).toEqual([])
  } finally {await sessions?.dispose(); await rm(root, {recursive: true, force: true})}
})

test("относительный cwd не позволяет сменить владельца через историю", () => {
  expect(ownerCwd(".")).toBe(".")
  for (const value of ["..", "../other", "subfolder", ""]) expect(() => ownerCwd(value)).toThrow("владельцем")
})

test("intent между владельцами следует за всем деревом при повторных переносах", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-intent-portability-"))
  let project = join(root, "first")
  try {
    const original = join(project, "old/meta/chat/session.json")
    await writeMoveIntent(original, {schemaVersion: 1, id: "session", executorId: "executor",
      from: {address: "/old", cwd: join(project, "old")}, to: {address: "/new", cwd: join(project, "new")}})
    expect((await readFile(`${original}.relocated`, "utf8")).includes(root)).toBeFalse()
    for (const name of ["second", "third"]) {
      const destination = join(root, name)
      await rename(project, destination)
      project = destination
      expect(await readMoveIntent(join(project, "old/meta/chat/session.json"))).toMatchObject({
        from: {cwd: join(project, "old")}, to: {cwd: join(project, "new")},
      })
    }
  } finally {await rm(root, {recursive: true, force: true})}
})
