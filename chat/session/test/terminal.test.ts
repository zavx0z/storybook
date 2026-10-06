import {expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {openArchive} from "../src/archive"

test("terminal aggregate читает ordered stdout/stderr и exit из evidence, occurrence остаётся точной", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-terminal-"))
  const metadata = {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle" as const, error: null}
  const file = join(directory, "chat.json")
  let archive = await openArchive(file, metadata)
  try {
    const cursor = {}
    await archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Команда", _meta: {terminal_info: {terminal_id: "terminal", cwd: "/workspace"}}}, "live", cursor)
    await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", _meta: {terminal_output_delta: {terminal_id: "terminal", stream: "stdout", data: "Первая строка\n"}}}, "live", cursor)
    const first = archive.groupPage("service:prelude").items.at(-1)!
    await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", _meta: {terminal_output_delta: {terminal_id: "terminal", stream: "stderr", data: "Ошибка\n"}}}, "live", cursor)
    await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", rawOutput: {exit_code: 1}, _meta: {terminal_exit: {terminal_id: "terminal", exit_code: 1, signal: null}}}, "live", cursor)
    const id = archive.findTool("tool")!.id
    const page = archive.terminalPage(id)
    expect(page.chunks.map(chunk => [chunk.stream, chunk.text])).toEqual([["stdout", "Первая строка\n"], ["stderr", "Ошибка\n"]])
    expect(page.exit).toEqual({code: 1, signal: null})
    expect(page.cwd).toBe("/workspace")
    expect(archive.body(id).terminal).toEqual(page)
    const occurrence = archive.groupBody("service:prelude", first.id).entry
    expect(occurrence.kind === "tool" && occurrence.call._meta).toEqual({terminal_output_delta: {terminal_id: "terminal", stream: "stdout", data: "Первая строка\n"}})
    await archive.dispose()
    await rm(archive.cacheFile)
    archive = await openArchive(file, metadata)
    expect(archive.terminalPage(id)).toEqual(page)
  } finally {await archive.dispose(); await rm(directory, {recursive: true, force: true})}
})

test("terminal delta разбивается по Unicode cursor и page budget без потери или дублирования", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-terminal-pages-"))
  const archive = await openArchive(join(directory, "chat.json"), {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle", error: null})
  try {
    const text = "Вывод🙂\n".repeat(500)
    await archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Вывод", _meta: {terminal_output_delta: {terminal_id: "t", data: text}}}, "live", {})
    const id = archive.findTool("tool")!.id
    let cursor: {ordinal: number; offset: number} | undefined
    let result = ""
    let pages = 0
    do {
      const page = archive.terminalPage(id, {maxBytes: 1024, ...(cursor ? {cursor} : {})})
      expect(page.bytes).toBeLessThanOrEqual(1024)
      expect(page.chunks.every(chunk => chunk.stream === "combined")).toBeTrue()
      result += page.chunks.map(chunk => chunk.text).join("")
      cursor = page.next ?? undefined
      pages++
    } while (cursor)
    expect(pages).toBeGreaterThan(1)
    expect(result).toBe(text)
  } finally {await archive.dispose(); await rm(directory, {recursive: true, force: true})}
})

test("повторный replay terminal deltas заменяет projection и не удваивает вывод", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-terminal-replay-"))
  const metadata = {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle" as const, error: null}
  const archive = await openArchive(join(directory, "chat.json"), metadata)
  try {
    await archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Вывод"}, "live", {})
    for (const text of ["one", "two"]) await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", _meta: {terminal_output_delta: {terminal_id: "t", data: text}}}, "live", {})
    for (let replay = 0; replay < 2; replay++) {
      const cursor = {}
      for (const text of ["one", "two"]) await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", _meta: {terminal_output_delta: {terminal_id: "t", data: text}}}, "replay", cursor)
    }
    const id = archive.findTool("tool")!.id
    expect(archive.terminalPage(id).chunks.map(chunk => chunk.text).join("")).toBe("onetwo")
    expect(archive.evidence(id).total).toBe(7)
  } finally {await archive.dispose(); await rm(directory, {recursive: true, force: true})}
})

test("большой terminal occurrence читается порциями, continuation не захватывает будущий вывод", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-terminal-occurrence-"))
  const archive = await openArchive(join(directory, "chat.json"), {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle", error: null})
  try {
    const text = "x".repeat(600_000)
    await archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Вывод", _meta: {terminal_output_delta: {terminal_id: "t", data: text}}}, "live", {})
    const occurrence = archive.groupPage("service:prelude").items[0]!
    await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", _meta: {terminal_output_delta: {terminal_id: "t", data: "FUTURE"}}}, "live", {})
    const body = archive.groupBody("service:prelude", occurrence.id)
    expect(body.bytes).toBeLessThan(128 * 1024)
    expect(body.terminal?.next?.evidenceId).toBe(occurrence.evidenceId)
    let result = body.terminal!.chunks.map(chunk => chunk.text).join("")
    let cursor = body.terminal!.next
    while (cursor) {
      const page = archive.terminalPage(occurrence.entryId, {cursor, maxBytes: 512 * 1024})
      result += page.chunks.map(chunk => chunk.text).join("")
      cursor = page.next
    }
    expect(result).toBe(text)
    expect(result).not.toContain("FUTURE")
  } finally {await archive.dispose(); await rm(directory, {recursive: true, force: true})}
})
