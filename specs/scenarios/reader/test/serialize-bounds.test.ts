import {expect, spyOn, test} from "bun:test"
import {createDocument} from "@zavx0z/immersive"
import {serialize, serializeArguments} from "../src/serialize"
import {observeMatcher} from "../src/matcher-metadata"
import {inspectSnapshot} from "./fixture/snapshot"

test("semantic Document и Root-like holder не раскрывают циклический runtime граф", async () => {
  const document = createDocument()
  const container = document.createElement("div")
  document.append(container)
  for (let index = 0; index < 5000; index++) container.append(document.createElement("span"))
  let reads = 0
  const root = {document, render() {}, getProjection() {}, lifetime: new Promise(() => {}),
    get internal() {reads++; throw new Error("Runtime getter не читается")}}
  const snapshot = await serialize({document, alias: document, root, aliasRoot: root, input: {id: "branch", width: 120, height: 80}})
  expect(snapshot).toMatchObject({document: {$type: "opaque", kind: "dom"}, alias: {$type: "reference", path: ["document"]},
    root: {$type: "opaque", kind: "runtime", name: "Root"}, aliasRoot: {$type: "reference", path: ["root"]},
    input: {id: "branch", width: 120, height: 80}})
  expect(JSON.stringify(snapshot).length).toBeLessThan(1000)
  expect(inspectSnapshot(snapshot).references.every(reference => reference.resolved && reference.targetIsObject)).toBe(true)
  expect(reads).toBe(0)
})

test("глубокий plain graph и широкий plain объект имеют явную границу данных", async () => {
  const deep: {next?: unknown} = {}
  let tail = deep
  for (let index = 0; index < 10000; index++) {const next = {}; tail.next = next; tail = next}
  const values = new Array(1000).fill(7)
  const wide = Object.fromEntries(Array.from({length: 100000}, (_, index) => [`key:${index}`, {index, values}]))
  const started = performance.now()
  const snapshot = await serialize({deep, wide})
  const json = JSON.stringify(snapshot)
  expect(json).toContain('"$type":"truncated"')
  expect(json).toContain('"depth-budget"')
  expect(json).toContain('"property-budget"')
  expect(json.length).toBeLessThan(300000)
  expect(performance.now() - started).toBeLessThan(1500)
})

test("args сохраняет array protocol и корректные shared references перед marker хвоста", async () => {
  const shared = {id: "same"}
  const input = [shared, shared, ...new Array(100000).fill(1)]
  const snapshot = await serializeArguments(input)
  expect(Array.isArray(snapshot)).toBe(true)
  expect(snapshot[0]).toEqual(shared)
  expect(snapshot[1]).toEqual({$type: "reference", path: [0]})
  expect(snapshot.at(-1)).toMatchObject({$type: "truncated", kind: "array-tail", length: input.length})
  expect(snapshot.length).toBeLessThan(1000)
  expect(inspectSnapshot(snapshot).references.every(reference => reference.resolved)).toBe(true)
})

test("раннее исчерпание времени корневого args не превращает TraceCall.args в object", async () => {
  const now = spyOn(performance, "now")
  let call = 0
  now.mockImplementation(() => call++ === 0 ? 0 : 1000)
  try {expect(await serializeArguments([1])).toEqual([{$type: "truncated", kind: "value", reason: "time-budget"}])}
  finally {now.mockRestore()}
})

test("never-settling nested Promise завершается descriptor pending; late settlement не изменяет снимок", async () => {
  const delayed = Promise.withResolvers<unknown>()
  const started = performance.now()
  const snapshot = await serialize({useful: 7, lifetime: delayed.promise})
  expect(snapshot).toMatchObject({useful: 7, lifetime: {$type: "promise", status: "pending", truncated: {reason: "promise-time-budget"}}})
  expect(performance.now() - started).toBeLessThan(500)
  const before = JSON.stringify(snapshot)
  delayed.resolve({late: true, enormous: new Array(100000).fill(1)})
  await Promise.resolve()
  expect(JSON.stringify(snapshot)).toBe(before)
})

test("Promise моменты сохраняют общий бюджет снимка при повторении большого результата", async () => {
  const graph = {rows: Array.from({length: 500}, (_, index) => ({index, label: "large".repeat(1000)}))}
  const started = performance.now()
  const snapshot = await serializeArguments(Array.from({length: 128}, () => Promise.resolve(graph)))
  expect(Array.isArray(snapshot)).toBe(true)
  expect(JSON.stringify(snapshot).length).toBeLessThan(1000000)
  expect(snapshot.slice(1).some(value => JSON.stringify(value).includes('-budget'))).toBe(true)
  expect(performance.now() - started).toBeLessThan(500)
})

test("Proxy, function Proxy и getters не выполняются; зарегистрированный matcher сохраняется", async () => {
  let traps = 0
  const proxy = new Proxy({}, {ownKeys() {traps++; throw new Error("ownKeys")}, get() {traps++; throw new Error("get")}, getPrototypeOf() {traps++; throw new Error("prototype")}})
  const fn = new Proxy(() => {}, {get() {traps++; throw new Error("name")}, getOwnPropertyDescriptor() {traps++; throw new Error("descriptor")}})
  const named = () => {}
  Object.defineProperty(named, "name", {get() {traps++; throw new Error("function name")}})
  const error = new Error("original")
  Object.defineProperty(error, "message", {get() {traps++; throw new Error("message")}})
  const registered = observeMatcher("safe", [], () => proxy)(42)
  const snapshot = await serialize({registered, fn, named, error})
  expect(snapshot).toMatchObject({registered: {$type: "matcher", name: "safe", args: [42]}, fn: {$type: "opaque", kind: "proxy"},
    named: {$type: "function"}, error: {$type: "error", message: {$type: "accessor"}}})
  expect(traps).toBe(0)
})

test("крупные строки и binary сверх 16MiB сообщают truncation, допустимый RGBA остаётся полным", async () => {
  const snapshot = await serialize({message: "x".repeat(1000000), tooLarge: new Uint8Array(17 * 1024 * 1024)})
  expect(snapshot).toMatchObject({message: {$type: "truncated", kind: "string", length: 1000000},
    tooLarge: {$type: "truncated", kind: "binary", reason: "binary-budget", byteLength: 17 * 1024 * 1024}})
  expect(JSON.stringify(snapshot).length).toBeLessThan(40000)
  const pixels = new Uint8Array(1920 * 1080 * 4)
  pixels[pixels.length - 1] = 255
  const frame = await serialize(pixels) as {data: string; properties: unknown}
  const restored = Buffer.from(frame.data, "base64")
  expect(restored.length).toBe(pixels.length)
  expect(restored.at(-1)).toBe(255)
  expect(frame.properties).toMatchObject({$type: "truncated", reason: "binary-property-budget"})
})
