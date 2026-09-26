import {describe, expect, test} from "bun:test"
import {exerciseProxy} from "./fixture"

describe.each([
  {name: "Развитие HTTP-ответа", steps: [
    {reply: {path: "example", children: []}},
    {reply: {future: {items: [null, "", 0, false, []]}}},
    {reply: {status: "new-domain-state", path: false, children: "not a navigation array", description: {arbitrary: true}}},
  ]},
  {name: "Статус как предметные данные", steps: [{reply: {status: "failed", value: 42}}, {reply: {status: "unavailable", value: null}}]},
  {name: "Смена HTTP-сервера", steps: [{reply: {first: true}}, {reply: {next: true}, switchServer: true}]},
])("$name", async ({steps}) => {
  const request = {path: "example"}
  const result = await exerciseProxy(steps, request)

  test("Ответ", () => {
    expect(result.replies, "JSON HTTP-сервера без проверки, добавления и удаления предметных полей в одном работающем прокси").toEqual(steps.map(step => step.reply))
  })
  test("Запрос", () => {
    expect(result.requests.map(entry => entry.input), "Переданный адрес без предметной интерпретации").toEqual(steps.map(() => request))
  })
  test("Транспорт", () => {
    expect(result.requests.map(({path, authorized}) => ({path, authorized})), "Фиксированная HTTP-точка входа с действующей авторизацией").toEqual(steps.map(() => ({path: "/api/control/storybook", authorized: true})))
  })
  test("Обновление адреса", () => {
    expect(result.requests.map(entry => entry.server), "Адрес и авторизация читаются перед запросом без перезапуска прокси").toEqual(steps.map(step => "switchServer" in step && step.switchServer ? 1 : 0))
  })
  test("Завершение", () => {
    expect(result.errors, "Изменение структуры успешного HTTP-ответа не становится ошибкой прокси").toEqual([])
  })
})
