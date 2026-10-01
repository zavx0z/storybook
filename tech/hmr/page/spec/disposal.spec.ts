import {expect, test} from "bun:test"
import createHmrPage from "@hmr/page"

test("замены сериализуются и dispose освобождает созданный после отмены scope", async () => {
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const released: string[] = []
  let mountedSecond = false
  const page = createHmrPage<string>({release(scope) { released.push(scope) }, async restore(scope) { return scope }})
  const first = page.replace(async () => { entered.resolve()
    await finish.promise
    return "first" }, () => {})
  const second = page.replace(async () => { mountedSecond = true
    return "second" }, () => {})
  const outcomes = Promise.allSettled([first, second])
  await entered.promise
  const disposal = page.dispose()
  finish.resolve()
  expect(await outcomes, "Текущая и ожидающая замены отклоняются после завершения").toMatchObject([{status: "rejected"}, {status: "rejected"}])
  await disposal
  expect(mountedSecond, "Ожидающая замена не создаёт новое исполнение").toBeFalse()
  expect(released, "Позднее исполнение текущей замены освобождается ровно один раз").toEqual(["first"])
  expect(page.current, "После завершения нет действующего исполнения").toBeNull()
  expect(page.dispose(), "Повторное завершение возвращает тот же Promise освобождения").toBe(disposal)
})
