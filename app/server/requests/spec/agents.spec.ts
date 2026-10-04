import {expect, test} from "bun:test"
import createJournal from "@zavx0z/storybook-app-server-requests"

test("локальный журнал выбирает агента по контексту, общий содержит всех", () => {
  const journal = createJournal()
  const input = JSON.stringify({path: "./same-target"})
  const base = {tool: "any-action", startedAt: 1, status: "success", input, result: "ok"}
  journal.write({...base, id: "a", agentId: "agent-a", address: "/a"})
  journal.write({...base, id: "b", agentId: "agent-b", address: "/b", startedAt: 2})
  journal.write({...base, id: "external", agentId: "external", startedAt: 3})
  expect(journal.read().map(entry => entry.id)).toEqual(["external", "b", "a"])
  expect(journal.read("/a").map(entry => entry.id)).toEqual(["a"])
  expect(journal.read("/b").map(entry => entry.id)).toEqual(["b"])
  expect(journal.read("/")).toEqual([])
  expect(journal.read("/same-target")).toEqual([])
  journal.write({...base, id: "a", agentId: "agent-a", address: "/a", status: "failed", result: "ошибка"})
  expect(journal.read("/a")[0]?.status).toBe("failed")
  expect(journal.read().find(entry => entry.id === "a")?.result).toBe("ошибка")
})

test("активность других агентов не вытесняет локальную историю", () => {
  const journal = createJournal()
  for (let index = 0; index < 30; index++) journal.write({id: `a-${index}`, tool: "local", startedAt: index, status: "success", address: "/a"})
  for (let index = 0; index < 30; index++) journal.write({id: `b-${index}`, tool: "another", startedAt: index + 30, status: "success", address: "/b"})
  expect(journal.read()).toHaveLength(20)
  expect(journal.read("/a")).toHaveLength(20)
  expect(journal.read("/a")[0]?.id).toBe("a-29")
  expect(journal.read("/a").at(-1)?.id).toBe("a-10")
})
