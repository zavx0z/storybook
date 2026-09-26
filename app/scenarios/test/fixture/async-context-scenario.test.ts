import {afterAll, beforeAll, describe, expect, test} from "bun:test"
import {delayedValue} from "./trace-functions"
import {AsyncLocalStorage} from "node:async_hooks"

const applicationContext = new AsyncLocalStorage<string>()
test("Контекст приложения", async () => {
  await applicationContext.run("контекст приложения", async () => {
    await Bun.sleep(1)
    expect(applicationContext.getStore(), "Наблюдение не стирает AsyncLocalStorage приложения").toBe("контекст приложения")
  })
})

describe.each(await Promise.resolve([{name: "Внешний await"}]))("$name", () => {
  test("Таблица", () => {
    expect(true, "Асинхронная подготовка таблицы до регистрации группы").toBeTrue()
  })
})

describe.each([{name: "Первый", delay: 8}, {name: "Второй", delay: 1}])("$name", async ({name, delay}) => {
  await delayedValue("до:" + name, delay)
  const result = await delayedValue("после:" + name, 1)
  beforeAll(async () => {
    await Bun.sleep(1)
    await delayedValue("beforeAll:" + name, 1)
  })
  afterAll(async () => {
    await Bun.sleep(1)
    await delayedValue("afterAll:" + name, 1)
  })
  test.each([{name: "Асинхронная таблица", value: (await delayedValue("таблица:" + name, 1)).value}])("$name", ({value}) => {
    expect(value, "Аргументы each вычисляются до регистрации теста").toBe("таблица:" + name)
  })

  describe("Вложенная группа", async () => {
    await Bun.sleep(1)
    const nested = await delayedValue("вложенный:" + name, 1)
    test("Вложенный результат", () => {
      expect(nested.value, "Значение вложенной асинхронной подготовки").toBe("вложенный:" + name)
    })
  })

  test("Результат варианта", async () => {
    await Bun.sleep(1)
    expect(result.value, "Значение подготовки после первого await").toBe("после:" + name)
    expect(await delayedValue("тест:" + name, 1), "Вызов после await внутри теста").toEqual({value: "тест:" + name})
  })
})
