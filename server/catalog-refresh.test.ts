import {expect, test} from "bun:test"
import {createCatalogRefresh} from "./catalog-refresh.ts"

test("одновременные запросы каталога делят проход, явная проверка сохраняется", async () => {
  const calls: boolean[] = []
  const refresh = createCatalogRefresh(async force => { calls.push(force); return calls.length })
  const first = refresh()
  const second = refresh(true)
  expect(first).toBe(second)
  expect(await first).toBe(1)
  expect(calls).toEqual([true])
})

test("изменение во время прохода не теряется и не запускает параллельный проход", async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const calls: boolean[] = []
  const refresh = createCatalogRefresh(async force => {
    calls.push(force)
    if (calls.length === 1) await gate
    return calls.length
  })
  const first = refresh()
  await Promise.resolve()
  const following = refresh(true)
  expect(calls).toEqual([false])
  release()
  expect(await following).toBe(2)
  expect(await first).toBe(2)
  expect(calls).toEqual([false, true])
})

test("ошибка обновления не оставляет навсегда отклонённый общий promise", async () => {
  let calls = 0
  const refresh = createCatalogRefresh(async () => {
    if (++calls === 1) throw new Error("source unavailable")
    return calls
  })
  await expect(refresh()).rejects.toThrow("source unavailable")
  expect(await refresh()).toBe(2)
})
