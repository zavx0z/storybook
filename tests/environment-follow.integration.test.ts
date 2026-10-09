import {expect, test} from "bun:test"
import {environmentActivity} from "../app/server/src/environment"
import {createEnvironmentFollow} from "../app/web/page/src/environment-follow"

test("принятый CallEvent проходит JSON transport и вызывает следование по адресу владельца", async () => {
  const call: Parameters<typeof environmentActivity>[0] = {
    id: "accepted-call", executorId: "fixture-executor", address: "/storybook/app/server",
    name: "filesystem.read", arguments: {path: "private-source.ts"}, phase: "running", startedAt: 1791500000123, durationMs: null,
  }
  const activity = environmentActivity(call)
  expect(activity).toEqual({type: "environment.activity", id: call.id, address: call.address, startedAt: call.startedAt})
  const lifetime = new AbortController()
  const addresses: string[] = []
  const follow = createEnvironmentFollow({enabled: () => true, subscribe: () => () => {}, signal: lifetime.signal,
    navigate: async address => {addresses.push(address)}, failed: error => {throw error}})
  follow.receive(JSON.parse(JSON.stringify(activity)))
  await follow.whenSettled()
  expect(addresses).toEqual([call.address])
  expect(environmentActivity({...call, name: "storybook_inspect"})).toBeNull()
  lifetime.abort()
})
