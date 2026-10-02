import {expect, test} from "bun:test"
import PageTarget from "../index"

const fallback = {
  protocol: "storybook-package-prepare/1", packageId: "@fixture/legacy",
  revision: null, revisionUrl: null, payloadUrl: null, route: "", urlPath: "/fixture/legacy",
  intent: "reader", preview: false, readerToken: "reader", initialAppliedRevision: null, fallbackRevision: null,
}

test("старая ревизия открывается как fallback текущей оболочки без executable URL", async () => {
  const fetcher = (async (_input: unknown) => Response.json(fallback)) as typeof fetch
  expect(await PageTarget.prepare(fetcher, {packageId: fallback.packageId, route: "", intent: "navigation"}, new AbortController().signal))
    .toMatchObject({kind: "fallback", packageId: fallback.packageId, revision: null, revisionUrl: null, payloadUrl: null})
})

test.each([
  {revisionUrl: "/__storybook/revisions/old/"},
  {payloadUrl: "/__storybook/revisions/old/revision-payload.js"},
  {intent: "preview", preview: true},
])("fallback не несёт скрытый executable payload или preview: %p", async patch => {
  const fetcher = (async (_input: unknown) => Response.json({...fallback, ...patch})) as typeof fetch
  await expect(PageTarget.prepare(fetcher, {packageId: fallback.packageId, route: "", intent: "navigation"}, new AbortController().signal))
    .rejects.toThrow("invalid")
})

test("cold fallback JSON читается без импорта runtime владельца", () => {
  const document = {getElementById: () => ({localName: "script", textContent: JSON.stringify({...fallback, kind: "fallback"})})} as unknown as Document
  expect(PageTarget.read(document)).toMatchObject({kind: "fallback", revision: null, packageId: fallback.packageId})
})
