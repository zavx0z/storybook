import {expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"

test("новый store читает общие и агентские настройки; конкурирующие writers проверяют одну revision", async () => {
  const project = await mkdtemp(join(tmpdir(), "execution-store-"))
  try {
    const first = createSettings({project})
    const initial = await first.read()
    const saved = await first.update({...initial, connections: [{id: "codex", provider: "codex", label: "Рабочий Codex", enabled: true}],
      general: {model: "a"}, types: {Component: {thoughtLevel: "high"}}})
    const subject = {address: "/component", label: "Компонент", cwd: join(project, "component"), type: "Component" as const}
    await first.updateExecutor({subject, executorId: "agent", selection: {model: "b"}})
    const reopened = createSettings({project})
    expect(await reopened.read()).toEqual(saved)
    expect(await reopened.readExecutor({subject, executorId: "agent"})).toEqual({model: "b"})
    const competing = await Promise.allSettled([
      first.update({...saved, general: {model: "first"}}),
      reopened.update({...saved, general: {model: "second"}}),
    ])
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1)
    expect((await reopened.read()).revision).toBe(saved.revision + 1)
  } finally { await rm(project, {recursive: true, force: true}) }
})
