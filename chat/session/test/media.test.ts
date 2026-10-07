import {expect, test} from "bun:test"
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createMediaStore} from "../src/media"
import {openArchive} from "../src/archive"

test("оригинал один для input и replay, normalized history не содержит base64, ACP roundtrip точен", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-"))
  try {
    const store = createMediaStore(directory)
    const data = Buffer.from("binary original including nul\0 and text").toString("base64")
    const original = [{type: "image", data, mimeType: "image/png", _meta: {source: "camera"}},
      {type: "text", text: `caption[@image](data:image/png;base64,${data})suffix`}]
    const normalized = await store.normalize(original)
    expect(JSON.stringify(normalized)).not.toContain(data)
    expect(await store.materialize(normalized)).toEqual(original)
    expect((await readdir(join(directory, "media"))).filter(name => !name.startsWith("."))).toHaveLength(1)
    expect(store.references(normalized)).toHaveLength(1)
    expect(await store.normalize(normalized)).toEqual(normalized)
    expect((normalized as any[])[0].type).toBe("resource_link")
    expect(typeof (store.project(normalized) as any[])[1].text).toBe("string")
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("resource metadata и оригинальные байты сохраняются, corruption и invalid base64 не скрываются", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-"))
  try {
    const store = createMediaStore(directory)
    const source = {type: "resource", resource: {uri: "attachment:123/report.pdf", mimeType: "application/pdf", blob: "AQID"}}
    const stored = await store.normalize(source)
    expect(await store.materialize(stored)).toEqual(source)
    const ref = store.references(stored)[0]!
    await writeFile(join(directory, "media", ref.digest), new Uint8Array([3, 2, 1]))
    await expect(store.read(ref)).rejects.toThrow("целостность")
    await expect(store.normalize({type: "image", data: "garbage", mimeType: "image/png"})).rejects.toThrow("base64")
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("любой image data URI хранится обратимо, UI image path не меняет canonical текст или message identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-"))
  try {
    const store = createMediaStore(directory)
    const source = {type: "text", text: '![Логотип](data:image/png;base64,AQID) и "data:image/png;base64,AQID"'}
    const stored = await store.normalize(source)
    expect(JSON.stringify(stored)).not.toContain("AQID")
    expect(await store.materialize(stored)).toEqual(source)
    expect((store.project(stored) as {text: string}).text).toMatch(/!\[Логотип\]\(\/__chat_media\/[a-f0-9]{64}\)/u)
    expect((await readdir(join(directory, "media"))).length).toBe(1)
    const malformed = {type: "text", text: "data:image/png;base64,AAAAA"}
    expect(await store.normalize(malformed)).toEqual(malformed)
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("utf8 marker восстанавливает exact Unicode с BOM, unknown encoding и invalid UTF-8 отклоняются", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-"))
  try {
    const store = createMediaStore(directory)
    const text = "\uFEFFЗаметка 🌍\r\n"
    const ref = await store.put(Buffer.from(text, "utf8"), {mimeType: "text/plain"})
    const marker = {$chatMedia: ref, encoding: "utf8"}
    expect(await store.materialize(marker)).toBe(text)
    expect(await store.normalize(marker)).toEqual(marker)
    expect(store.references(marker)).toEqual([ref])
    await expect(store.materialize({$chatMedia: ref, encoding: "hex"})).rejects.toThrow("кодировка")
    const corrupt = await store.put(new Uint8Array([0xff]), {mimeType: "text/plain"})
    await expect(store.materialize({$chatMedia: corrupt, encoding: "utf8"})).rejects.toThrow()
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("data URI в произвольном raw string сохраняется обратимо; JSON и code не становятся image blocks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-text-"))
  try {
    const store = createMediaStore(directory)
    const source = {rawOutput: 'const icon = "data:image/png;base64,AQID";\r\n',
      unknown: ['{"literal":"data:image/webp;base64,AQID"}', "AQID", "data:image/png;base64,AAAAA"],
      input: {type: "text", text: '{"answer":42,"icon":"data:image/png;base64,AQID"}'}}
    const normalized = await store.normalize(source, undefined, "payload")
    expect(await store.materialize(normalized)).toEqual(source)
    expect(await store.normalize(normalized, undefined, "payload")).toEqual(normalized)
    expect(store.references(normalized)).toHaveLength(1)
    expect(await readdir(join(directory, "media"))).toHaveLength(1)
    const projected = store.project(normalized) as typeof source
    expect(typeof projected.rawOutput).toBe("string")
    expect(projected.rawOutput).toMatch(/^const icon = "\/__chat_media\/[a-f0-9]{64}";\r\n$/u)
    expect(typeof projected.unknown[0]).toBe("string")
    expect(projected.unknown.slice(1)).toEqual(source.unknown.slice(1))
    expect(projected.input.type).toBe("text")
    expect(projected.input.text).toContain('"answer":42')
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("ACP и history identity остаются строками; одноимённые поля raw payload не становятся protocol", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-scopes-"))
  try {
    const store = createMediaStore(directory)
    const uri = "data:image/png;base64,AQID"
    const update = {sessionUpdate: "tool_call", toolCallId: uri, title: uri,
      rawOutput: {id: uri, title: uri, type: "image", data: "AQID"},
      _meta: {terminal_output_delta: {terminalId: uri, data: uri, stream: "stdout"}},
      content: [{type: "content", content: {type: "text", text: uri}}]}
    const normalized = await store.normalize(update, undefined, "update") as typeof update
    expect(normalized.toolCallId).toBe(uri)
    expect(normalized.title).toBe(uri)
    expect(normalized.sessionUpdate).toBe(update.sessionUpdate)
    expect(normalized._meta).toEqual(update._meta)
    expect(normalized.rawOutput.id).not.toBe(uri)
    expect(normalized.rawOutput.title).not.toBe(uri)
    expect(normalized.rawOutput.type).toBe("image")
    expect(normalized.rawOutput.data).toBe("AQID")
    expect(await store.materialize(normalized)).toEqual(update)
    const projected = store.project(normalized) as typeof update
    expect(typeof projected.rawOutput.id).toBe("string")
    expect(projected.rawOutput.id).toMatch(/^\/__chat_media\/[a-f0-9]{64}$/u)
    const mutations = [{type: "append", item: {id: uri, kind: "tool", origin: "live", toolCallId: uri, requestId: uri, call: update}},
      {type: "purpose", id: uri}]
    const stored = await store.normalize(mutations, undefined, "mutations") as typeof mutations
    expect(stored[0]!.item!.id).toBe(uri)
    expect(stored[0]!.item!.toolCallId).toBe(uri)
    expect(stored[0]!.item!.requestId).toBe(uri)
    expect(stored[1]!.id).toBe(uri)
    expect(await store.materialize(stored)).toEqual(mutations)
  } finally {await rm(directory, {recursive: true, force: true})}
})

test("повторные tool rawOutput data URI не дублируют binary в journal; evidence и rebuild восстанавливают точный текст", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-raw-output-"))
  const file = join(directory, "chat.json")
  const metadata = {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true,
    status: "idle" as const, error: null}
  let archive = await openArchive(file, metadata)
  try {
    const data = Buffer.alloc(64 * 1024, 171).toString("base64")
    const rawOutput = `const image = "data:image/png;base64,${data}";\r\nconsole.log("Текст остаётся кодом 🌍");\r\n`
    const toolCallId = "data:image/png;base64,AQID"
    const updates = [{sessionUpdate: "tool_call" as const, toolCallId, title: toolCallId, rawOutput},
      ...Array.from({length: 3}, (_, index) => ({sessionUpdate: "tool_call_update" as const, toolCallId, rawOutput,
        title: `Обновление ${index}`}))]
    for (const update of updates) await archive.receive(update, "live", {})
    const sessionLabel = "data:image/png;base64,AQID"
    await archive.commit({...archive.metadata, sessionLabel})
    const tool = archive.findTool(toolCallId)!
    const header = JSON.parse(await readFile(file, "utf8")) as {journal: string}
    const journal = await readFile(join(directory, header.journal), "utf8")
    expect(journal).not.toContain(data)
    expect(Buffer.byteLength(journal)).toBeLessThan(16 * 1024)
    const check = async () => {
      expect(archive.metadata.sessionLabel).toBe(sessionLabel)
      const evidence = archive.evidence(tool.id).items
      expect(evidence).toHaveLength(updates.length)
      for (const [index, event] of evidence.entries()) expect(await archive.media.materialize(event.update)).toEqual(updates[index])
      const body = archive.body(tool.id).entry
      expect(body.kind).toBe("tool")
      if (body.kind !== "tool") throw new Error("Ожидался инструмент")
      expect(typeof body.call.rawOutput).toBe("string")
      expect(body.call.rawOutput).not.toContain(data)
      expect(body.call.rawOutput).toContain('console.log("Текст остаётся кодом 🌍")')
      expect(archive.media.references(evidence)).toHaveLength(1)
      expect(await readdir(join(directory, "media"))).toHaveLength(1)
    }
    await check()
    await archive.dispose()
    await rm(archive.cacheFile)
    archive = await openArchive(file, metadata)
    await check()
  } finally {await archive.dispose(); await rm(directory, {recursive: true, force: true})}
})

test("малое сообщение с text media projection помечается для точного source copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-copy-projection-"))
  const metadata = {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle" as const, error: null}
  const archive = await openArchive(join(root, "chat.json"), metadata)
  try {
    const text = "![Изображение](data:image/png;base64,AQID)"
    await archive.commit(undefined, [{type: "append", item: {id: "m", kind: "message", role: "user", origin: "local", content: [{type: "text", text}]}}])
    expect(archive.body("m").copyRequiresSource).toBeTrue()
    expect(archive.display().bodies?.[0]?.copyRequiresSource).toBeTrue()
    expect(await archive.media.materialize(archive.content("m"))).toEqual([{type: "text", text}])
    await archive.commit(undefined, [{type: "append", item: {id: "plain", kind: "message", role: "user", origin: "local", content: [{type: "text", text: "Plain"}]}}])
    expect(archive.body("plain").copyRequiresSource).toBeUndefined()
  } finally {await archive.dispose(); await rm(root, {recursive: true, force: true})}
})
