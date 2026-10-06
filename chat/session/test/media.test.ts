import {expect, test} from "bun:test"
import {mkdtemp, readdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createMediaStore} from "../src/media"

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
