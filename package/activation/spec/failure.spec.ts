import {expect, test} from "bun:test"
import activateRevision from "@hmr/activation"

test.each([
  {packageId: "@fixture/b"}, {revision: "other"}, {route: "other"}, {graphDigest: "other"},
  {ready: false}, {presented: false}, {frameSequence: 0}, {frameSequence: "3"}, {consoleErrors: ["render failed"]},
])("не подтверждает несовпадающее свидетельство %j", async mismatch => {
  const expected = {packageId: "@fixture/a", revision: "revision-a", route: "", graphDigest: "graph-a"}
  let committed = false
  await expect(activateRevision({
    expected,
    signal: new AbortController().signal,
    async inspect() { return {...expected, ready: true, presented: true, frameSequence: 3, consoleErrors: [], ...mismatch} },
    commit() { committed = true },
  })).rejects.toThrow("did not pass activation verification")
  expect(committed, "Неподтверждённый кандидат не попадает в working revision").toBeFalse()
})

test("отмена во время инспекции сохраняет прежнее применение", async () => {
  const cancellation = new AbortController()
  const expected = {packageId: "@fixture/a", revision: "revision-a", route: "", graphDigest: "graph-a"}
  let committed = false
  await expect(activateRevision({
    expected,
    signal: cancellation.signal,
    async inspect() { cancellation.abort(new Error("view left"))
      return {...expected, ready: true, presented: true, frameSequence: 1, consoleErrors: []} },
    commit() { committed = true },
  })).rejects.toThrow("view left")
  expect(committed).toBeFalse()
})
