import {describe, expect, test} from "bun:test"
import {
  delayedValue,
  identityPromise,
  mutateValue,
  overlappingValue,
  receiverValue,
  rejectValue,
  throwValue,
} from "./trace-functions"

describe("Обычная группа", async () => {
  const result = await delayedValue("describe", 1)

  test("вызов зарегистрирован до test", () => {
    expect(result).toEqual({value: "describe"})
  })
})

describe.each([
  {name: "Первый вариант", props: {value: "each-one"}},
  {name: "Второй вариант", props: {value: "each-two"}},
])("$name", async ({props}) => {
  const result = await delayedValue(props.value, 1)

  test("получен результат варианта", () => {
    expect(result).toEqual({value: props.value})
  })
})

test("test без describe", async () => {
  expect(await delayedValue("root", 1)).toEqual({value: "root"})
})

describe("Параллельные тесты", () => {
  test.concurrent("медленный", async () => {
    expect(await overlappingValue("slow", 30)).toEqual({value: "slow", activeAtStart: 1})
  })

  test.concurrent("быстрый", async () => {
    await Bun.sleep(5)
    expect(await overlappingValue("fast", 1)).toEqual({value: "fast", activeAtStart: 2})
  })
})

test("Promise identity", () => {
  const promise = Promise.resolve("identity")
  expect(identityPromise(promise)).toBe(promise)
})

test("this вызова", () => {
  expect(receiverValue.call({prefix: "receiver"}, "value")).toBe("receiver:value")
})

test("аргумент может быть изменён функцией", () => {
  const value = {state: "before"}
  expect(mutateValue(value)).toBe("after")
})

test("синхронная ошибка", () => {
  expect(() => throwValue("boom")).toThrow("sync:boom")
})

test("отклонённый Promise", async () => {
  expect(rejectValue("boom")).rejects.toThrow("async:boom")
})
