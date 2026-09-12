/**
Проверяет окружение дочернего Bun при запуске сборщика из отладчика.
Занимает отдельный тестовый сокет и передаёт его адрес настройками инспектора.
Подтверждает исключение BUN_INSPECT и BUN_INSPECT_NOTIFY из дочернего окружения
при сохранении остальных переменных. Настройки родителя восстанавливаются,
тестовый сокет и временная директория освобождаются после проверки.

@packageDocumentation
*/
import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"

describe.each([
  {name: "Запуск из отладчика", props: {path: resolve(import.meta.dir, "fixture/inspector.ts")}},
])("$name", ({props}) => {
  let temporary: string | undefined
  let server: ReturnType<typeof Bun.listen> | undefined
  let original: Record<string, string | undefined> | undefined

  beforeEach(async () => {
    original = {
      BUN_INSPECT: process.env.BUN_INSPECT,
      BUN_INSPECT_NOTIFY: process.env.BUN_INSPECT_NOTIFY,
      SCENARIO_INSPECTOR_TEST: process.env.SCENARIO_INSPECTOR_TEST,
    }
    temporary = await mkdtemp(join(tmpdir(), "scenario-inspector-"))
    const socketPath = join(temporary, "debug.sock")
    server = Bun.listen({unix: socketPath, socket: {data() {}}})
    process.env.BUN_INSPECT = `ws+unix://${socketPath}`
    process.env.BUN_INSPECT_NOTIFY = `unix://${socketPath}`
    process.env.SCENARIO_INSPECTOR_TEST = "preserved"
  })

  afterEach(async () => {
    if (original) {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
    server?.stop(true)
    if (temporary) await rm(temporary, {recursive: true, force: true})
    original = undefined
    server = undefined
    temporary = undefined
  })

  test("Не наследует занятый сокет инспектора и сохраняет остальное окружение", async () => {
    const result = await readScenario(props)
    expect(result.stdout).toContain(JSON.stringify({
      inspectorConfigured: false,
      inspectorNotificationConfigured: false,
      inheritedValue: "preserved",
    }))
  })
})
