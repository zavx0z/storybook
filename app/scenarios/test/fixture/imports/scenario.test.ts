import {expect, test} from "bun:test"
import {visible as increment, type Input} from "./operations"
import {consume} from "./consumer"

test("вычисление", () => {
  const input: Input = 2
  expect(consume(increment(input)), "Результат двух последовательных операций").toBe(6)
})
