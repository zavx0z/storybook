/**
Лаунчер соединяет управляющий API с готовым сервером без запуска при создании.
Реальный daemon и применение ревизии проверяются отдельными интеграционными тестами.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import createApp, {type StorybookApp} from "@zavx0z/storybook-app"

describe.each([{
  name: "Готовый лаунчер",
  props: {toolRoot: resolve(import.meta.dir, "../..")},
}])("$name", ({props}) => {
  let launches = 0
  const input: StorybookApp.Input = {
    ...props,
    daemonEntryPath: resolve(props.toolRoot, "app/src/daemon-entry.ts"),
    spawnDaemon() {
      launches += 1
      throw new Error("Сценарий не запускает daemon")
    },
  }
  const app = createApp(input)

  test("Управляющий интерфейс", () => {
    const operations = ["ensure", "status", "attach", "detach", "search", "open", "wait", "inspect", "interact", "capture", "check", "close", "stop", "readResource"] as const
    expect(operations.map(name => typeof app[name]), "Один API соединяет запуск, пакетные операции, рабочее пространство и ресурсы")
      .toEqual(operations.map(() => "function"))
  })

  test("Создание не запускает сервер", () => {
    expect(launches, "Построение лаунчера сохраняет готовую среду до явной операции").toBe(0)
  })

  test.todo("Применение готовой ревизии", () => {
    expect(undefined, "Явная операция проверяет кандидата и отдельно подтверждает применение в рабочем представлении").toBeDefined()
  })
})
