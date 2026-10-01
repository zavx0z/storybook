/** Исполняемый scope заменяется в той же странице; данные предыдущего сохраняются для отката. */
import {afterAll, describe, expect, test} from "bun:test"
import createHmrPage from "@hmr/page"

describe.each([
  {name: "Первое содержимое", props: {previous: null, next: "первая версия"}},
  {name: "Обновление содержимого", props: {previous: "первая версия", next: "вторая версия"}},
])("$name", async ({props}) => {
  const released: string[] = []
  const accepted: string[] = []
  const page = createHmrPage<string>({
    release(scope) { released.push(scope) },
    async restore(scope) { return scope },
  })
  afterAll(() => page.dispose())
  if (props.previous !== null) await page.replace(async () => props.previous!, () => {})
  await page.replace(async () => props.next, scope => { accepted.push(scope) })

  test("Рабочее содержимое", () => {
    expect(page.current, "После завершения замены страница владеет новым исполнением").toBe(props.next)
  })
  test("Освобождение", () => {
    expect(released, "Прежнее исполнение освобождается ровно один раз; первая установка ничего не освобождает")
      .toEqual(props.previous === null ? [] : [props.previous])
  })
  test("Подключение представления", () => {
    expect(accepted, "Владелец интерфейса получает установленный scope для подключения адреса и отображения").toEqual([props.next])
  })
})
