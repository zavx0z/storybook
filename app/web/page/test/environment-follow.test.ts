import {expect, test} from "bun:test"
import {createEnvironmentFollow} from "../src/environment-follow"

test("следование выключено по умолчанию, принимает только начало работы и дедуплицирует событие", async () => {
  let enabled = false
  const listeners = new Set<() => void>()
  const calls: string[] = []
  const lifetime = new AbortController()
  const follow = createEnvironmentFollow({enabled: () => enabled, subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener)}},
    navigate: async address => {calls.push(address)}, failed: error => {throw error}, signal: lifetime.signal})
  const event = {type: "environment.activity", id: "first", address: "/one", startedAt: Date.now()}
  follow.receive(event)
  enabled = true
  for (const listener of listeners) listener()
  follow.receive(event)
  follow.receive({...event, type: "environment.finished", id: "result"})
  follow.receive({...event, id: "second", address: "/two"})
  follow.receive({...event, id: "second", address: "/two"})
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(calls).toEqual(["/two"])
  lifetime.abort()
})

test("выключение и новая активность отменяют позднее следование без ложного отказа", async () => {
  let enabled = true
  let changed = () => {}
  const lifetime = new AbortController()
  const entered: AbortSignal[] = []
  const releases: Array<() => void> = []
  const committed: string[] = []
  const errors: unknown[] = []
  const follow = createEnvironmentFollow({enabled: () => enabled, subscribe: listener => {changed = listener; return () => {}}, signal: lifetime.signal,
    failed: error => {errors.push(error)}, navigate: async (address, signal) => {
      entered.push(signal)
      await new Promise<void>(resolve => {releases.push(resolve)})
      signal.throwIfAborted()
      committed.push(address)
    }})
  const event = {type: "environment.activity", id: "a", address: "/a", startedAt: Date.now()}
  follow.receive(event)
  follow.receive({...event, id: "b", address: "/b"})
  expect(entered[0]!.aborted).toBe(true)
  enabled = false
  changed()
  expect(entered[1]!.aborted).toBe(true)
  for (const release of releases) release()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(committed).toEqual([])
  expect(errors).toEqual([])
  await expect(follow.run(async () => "late")).rejects.toThrow("following was disabled")
  lifetime.abort()
})

test("поздний старый start другого socket не возвращает workspace к прежнему адресу", async () => {
  const lifetime = new AbortController()
  const calls: string[] = []
  const follow = createEnvironmentFollow({enabled: () => true, subscribe: () => () => {}, signal: lifetime.signal,
    navigate: async address => {calls.push(address)}, failed: error => {throw error}})
  follow.receive({type: "environment.activity", id: "newer", address: "/b", startedAt: 200})
  follow.receive({type: "environment.activity", id: "older", address: "/a", startedAt: 100})
  await follow.whenSettled()
  expect(calls).toEqual(["/b"])
  lifetime.abort()
})
