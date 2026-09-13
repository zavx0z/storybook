/**
Проверяет перенос значений независимо от запуска Bun и компиляции сценариев.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {serialize} from "../src/serialize"

test("не вызывает getter при чтении значения", async () => {
  let calls = 0
  await serialize({
    get value() {
      calls++
      return 1
    },
  })
  expect(calls, "Сериализация не должна исполнять getter").toBe(0)
})

test("обозначает циклическую ссылку", async () => {
  const value: {self?: unknown} = {}
  value.self = value
  expect(await serialize(value), "Цикл должен ссылаться на уже прочитанный объект").toEqual({self: {$type: "reference", path: "$"}})
})

test("сохраняет причину отклонения Promise", async () => {
  expect(await serialize(Promise.reject(new Error("Ошибка"))), "Причина отклонения должна попасть в снимок").toEqual({
    $type: "promise", status: "rejected", error: {$type: "error", name: "Error", message: "Ошибка"},
  })
})
