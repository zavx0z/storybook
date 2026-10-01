import {expect, test} from "bun:test"
import {Counter, increment} from "./constructors"

class Derived extends Counter {}

test("Конструктор", () => {
  const value = new Counter(3)
  expect(value.read(), "Конструктор и приватное состояние экземпляра сохраняются при наблюдении").toBe(3)
  expect(value instanceof Counter, "Экземпляр сохраняет прототип наблюдаемого класса").toBeTrue()
  expect(Counter.label, "Статические свойства принадлежат тому же классу").toBe("Счётчик")
})
test("Наследование", () => {
  const value = new Derived(7)
  expect(value.read(), "Наследник получает состояние базового класса через настоящий new.target").toBe(7)
  expect(value instanceof Derived && value instanceof Counter, "Цепочка прототипов сохраняется").toBeTrue()
})
test("Обычный вызов", () => {
  expect(increment(2), "Функция продолжает вызываться обычным способом").toBe(3)
})
