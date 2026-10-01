import {expect, test} from "bun:test"
import {STORYBOOK_PAGE_REALM_PROTOCOL} from "./package-entry.ts"
import {createStorybookAppliedRevisionLoader} from "./revision-loader.ts"

test("загружает только literal payload URL той же package revision", async () => {
  const urls: string[] = []
  const payload = {protocol: STORYBOOK_PAGE_REALM_PROTOCOL, candidateRevision: "revision-1"}
  const load = createStorybookAppliedRevisionLoader("@fixture/components", async url => {
    urls.push(url)
    return {STORYBOOK_APPLIED_REVISION: payload}
  })

  const loaded: unknown = await load("revision-1", new AbortController().signal)
  expect(loaded === payload).toBe(true)
  expect(urls).toEqual([
    "/__storybook/revisions/%40fixture%2Fcomponents/revision-1/revision-payload.js",
  ])
})

test("отклоняет неограниченный revision и отменённую загрузку до import", async () => {
  const calls: string[] = []
  const load = createStorybookAppliedRevisionLoader("@fixture/components", async url => {
    calls.push(url)
    return {STORYBOOK_APPLIED_REVISION: {protocol: STORYBOOK_PAGE_REALM_PROTOCOL}}
  })
  const controller = new AbortController()
  controller.abort()

  await expect(load("../outside", new AbortController().signal)).rejects.toThrow("revision is invalid")
  await expect(load("..", new AbortController().signal)).rejects.toThrow("revision is invalid")
  await expect(load("revision-1", controller.signal)).rejects.toThrow("abort")
  expect(calls).toEqual([])
})

test("проверяет protocol после import и повторно проверяет отмену", async () => {
  const controller = new AbortController()
  const canceled = createStorybookAppliedRevisionLoader("@fixture/components", async () => {
    controller.abort()
    return {STORYBOOK_APPLIED_REVISION: {protocol: STORYBOOK_PAGE_REALM_PROTOCOL}}
  })
  const malformed = createStorybookAppliedRevisionLoader("@fixture/components", async () => ({
    STORYBOOK_APPLIED_REVISION: {protocol: "foreign"},
  }))

  await expect(canceled("revision-1", controller.signal)).rejects.toThrow("abort")
  await expect(malformed("revision-1", new AbortController().signal)).rejects.toThrow("invalid protocol")
})
