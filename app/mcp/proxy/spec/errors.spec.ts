import {describe, expect, test} from "bun:test"
import {exerciseProxy} from "./fixture"

describe.each([
  {name: "Ошибка HTTP", step: {httpStatus: 403, reply: {error: "Доступ запрещён"}}, error: "Доступ запрещён"},
  {name: "Неверный JSON", step: {body: "not json"}, error: "invalid JSON"},
  {name: "Неверная транспортная форма", step: {body: "null"}, error: "invalid JSON"},
])("$name", async ({step, error}) => {
  const result = await exerciseProxy([step])
  test("Ошибка транспорта", () => {
    expect(result.errors[0]?.message, "Отказ HTTP или повреждение транспортного JSON не выдаётся за успешный ответ").toContain(error)
  })
  test("Отсутствие подмены", () => {
    expect(result.replies, "Вместо ошибочного ответа не создаётся пустой предметный результат").toEqual([])
  })
})

describe("Отмена запроса", async () => {
  const result = await exerciseProxy([{abort: true}])
  test("Состояние", () => {
    expect(result.errors[0]?.name, "Сигнал отмены проходит к HTTP-транспорту").toBe("AbortError")
  })
  test("Доставка", () => {
    expect(result.requests, "Отменённый до отправки запрос не достигает HTTP-сервера").toEqual([])
  })
})
