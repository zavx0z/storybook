import {expect, test} from "bun:test"
import {createEnvironmentFollowState} from "../src/environment-follow-state"

test("переключатель workspace сохраняется и HMR snapshot имеет приоритет над внешним writer", () => {
  const values = new Map<string, string>()
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value)}} as Storage
  const first = createEnvironmentFollowState(() => storage)
  expect(first.getSnapshot()).toBe(false)
  let updates = 0
  first.subscribe(() => {updates++})
  first.toggle()
  expect(first.getSnapshot()).toBe(true)
  expect(updates).toBe(1)
  expect(createEnvironmentFollowState(() => storage).getSnapshot()).toBe(true)
  values.set("storybook.follow-environment.v1", "false")
  expect(createEnvironmentFollowState(() => storage, first.getSnapshot()).getSnapshot()).toBe(true)
  first.dispose()
})

test("недоступное хранилище сохраняет локальное переключение без включения по умолчанию", () => {
  const state = createEnvironmentFollowState(() => {throw new Error("storage unavailable")})
  expect(state.getSnapshot()).toBe(false)
  state.toggle()
  expect(state.getSnapshot()).toBe(true)
  state.dispose()
})
