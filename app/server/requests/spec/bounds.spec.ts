import {expect, test} from "bun:test"
import createJournal from "@zavx0z/storybook-app-server-requests"

const record = (id: string, address: string, result = "Ответ") => ({id, address, tool: "action", startedAt: 1, status: "success", input: "{}", result})

test("тысячи адресов оставляют ограниченные unique payload и LRU источники", () => {
  const journal = createJournal()
  for (let index = 0; index < 1000; index++) journal.write(record(`call:${index}`, `/agent-${index}`))
  expect(journal.residency()).toMatchObject({addresses: 64, records: 64, maxPayloadBytes: 32 * 1024 * 1024, maxAddresses: 64})
  expect(journal.read()).toHaveLength(20)
  expect(journal.read("/agent-0")).toEqual([])
  expect(journal.read("/agent-999")).toHaveLength(1)
  // Чтение сохраняет интерес к источнику; следующий write вытесняет другой адрес.
  expect(journal.read("/agent-936")).toHaveLength(1)
  journal.write(record("next", "/next"))
  expect(journal.read("/agent-936")).toHaveLength(1)
  expect(journal.read("/agent-937")).toEqual([])
  expect(journal.residency().addresses).toBe(64)
})

test("общий и локальный index считают одно тело один раз; bytepressure оставляет явную отметку", () => {
  const journal = createJournal({maxPayloadBytes: 12, maxAddresses: 2})
  journal.write(record("one", "/one", "123456"))
  expect(journal.residency().payloadBytes).toBe(8)
  journal.write(record("two", "/two", "123456"))
  expect(journal.residency().payloadBytes).toBe(8)
  const omitted = journal.read("/one")[0]!
  expect(omitted).toMatchObject({id: "one", input: "", result: "", omitted: {reason: "payload-budget", inputBytes: 2, resultBytes: 6}})
  expect(journal.summary().find(item => item.id === "one")).toMatchObject({inputBytes: 2, resultBytes: 6, omitted: omitted.omitted})
  expect(journal.read("/two")[0]?.result).toBe("123456")
  const returned = journal.read("/one")[0]!
  if (returned.omitted !== undefined) (returned.omitted as {inputBytes: number}).inputBytes = 999
  expect(journal.read("/one")[0]?.omitted?.inputBytes).toBe(2)
})

test("oversized single result не усекается и не остаётся в RAM; небольшое обновление восстанавливает полный ответ", () => {
  const journal = createJournal({maxPayloadBytes: 8})
  journal.write(record("large", "/one", "Большой результат"))
  expect(journal.residency().payloadBytes).toBe(0)
  expect(journal.read()[0]).toMatchObject({input: "", result: "", omitted: {reason: "payload-budget", resultBytes: Buffer.byteLength("Большой результат")}})
  journal.write(record("large", "/one", "ok"))
  expect(journal.read()[0]?.result).toBe("ok")
  expect(journal.read()[0]?.omitted).toBeUndefined()
  expect(journal.residency().payloadBytes).toBe(4)
})

test("равные startedAt сохраняют insertion new-first; completion старого вызова не переставляет его вперёд", () => {
  const journal = createJournal()
  journal.write({...record("one", "/one"), status: "running"})
  journal.write(record("two", "/one"))
  journal.write(record("three", "/one"))
  journal.write(record("one", "/one", "Завершён"))
  expect(journal.read().map(item => item.id)).toEqual(["three", "two", "one"])
  expect(journal.read("/one").map(item => item.id)).toEqual(["three", "two", "one"])
  expect(journal.summary().map(item => item.id)).toEqual(["three", "two", "one"])
})

test("LRU и смена адреса освобождают исчезнувшие canonical records без двойного вычитания bytes", () => {
  const journal = createJournal({maxAddresses: 1, maxPayloadBytes: 1024})
  journal.write(record("old", "/old"))
  for (let index = 0; index < 20; index++) journal.write({id: `global:${index}`, tool: "action", startedAt: 2, status: "success", input: "", result: ""})
  expect(journal.residency().payloadBytes).toBe(Buffer.byteLength("{}Ответ"))
  journal.write(record("old", "/new", "ok"))
  expect(journal.read("/old")).toEqual([])
  expect(journal.read("/new")[0]?.result).toBe("ok")
  expect(journal.residency().payloadBytes).toBe(4)
  journal.write(record("new", "/other", "a"))
  expect(journal.residency().payloadBytes).toBe(7)
})
