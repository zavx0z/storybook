import {describe, expect, test} from "bun:test"
import createHmrPage from "@storybook-tech-hmr/page"

describe("Отказ обновления", () => {
  test.each(["create", "accept"])("восстанавливает предыдущее исполнение при ошибке %s", async phase => {
    const released: string[] = []
    const restored: string[] = []
    const page = createHmrPage<string>({
      release(scope) { released.push(scope) },
      async restore(scope) { restored.push(scope)
        return `${scope}:restored` },
    })
    try {
      await page.replace(async () => "working", () => {})
      await expect(page.replace(async () => {
        if (phase === "create") throw new Error("candidate failed")
        return "candidate"
      }, (_, rollback) => {
        if (!rollback) throw new Error("candidate failed")
      })).rejects.toThrow("candidate failed")
      expect(page.current, "Рабочая привязка восстановлена после отказа кандидата").toBe("working:restored")
      expect(restored, "Откат использует данные предыдущей версии").toEqual(["working"])
      expect(released, "Созданное исполнение кандидата освобождается перед восстановлением")
        .toEqual(phase === "create" ? ["working"] : ["working", "candidate"])
    } finally { await page.dispose() }
  })

  test("ошибка восстановления остаётся явной", async () => {
    const page = createHmrPage<string>({release() {}, async restore() { throw new Error("rollback failed") }})
    await page.replace(async () => "working", () => {})
    await expect(page.replace(async () => { throw new Error("mount failed") }, () => {})).rejects.toBeInstanceOf(AggregateError)
    expect(page.current, "При неудачном восстановлении нет выдуманной рабочей версии").toBeNull()
    await page.dispose()
  })
})
