import {describe, expect, test} from "bun:test"
import createControl from "@zavx0z/storybook-app-control"
import {fixture} from "../test/fixture"

describe.each([
  {name: "Работающее окружение", props: {lifecycle: false, resources: true}},
  {name: "Команды лаунчера", props: {lifecycle: true, resources: false}},
])("$name", async ({props}) => {
  const controller = fixture()
  const control = createControl({...props, controller: () => controller.controller})
  const result = await control.tools.find(tool => tool.name === "storybook_status")!.execute({schemaVersion: 1})

  test("Общая возможность", () => {
    expect(result, "Оба транспорта вызывают публичный контроллер после одной общей проверки аргументов")
      .toEqual({status: "success", method: "status", input: {schemaVersion: 1}})
  })
  test("Действительный состав", () => {
    expect(control.tools.map(tool => tool.name).includes("storybook_ensure"),
      "Запуск остановленного сервера доступен только транспорту, который предоставляет launcher")
      .toBe(props.lifecycle)
  })
})
