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
  expect(await outcomes).toMatchObject([{status: "rejected"}, {status: "rejected"}])
  await disposal
  expect(mountedSecond).toBeFalse()
  expect(released).toEqual(["first"])
  expect(page.current).toBeNull()
  expect(page.dispose()).toBe(disposal)
})
