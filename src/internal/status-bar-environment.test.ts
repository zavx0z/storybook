import {describe, expect, test} from "bun:test"
import {readInjectedStorybookStatusBar} from "./status-bar-environment.ts"

const documentWithMeta = (entries: Readonly<Record<string, string>>): Document => ({
  querySelectorAll: () => Object.entries(entries).map(([name, content]) => ({name, content})),
}) as unknown as Document

describe("injected Storybook StatusBar environment", () => {
  test("reads the exact owner manifest text and rejects an incomplete shell", () => {
    expect(readInjectedStorybookStatusBar(documentWithMeta({
      "storybook-status-bar-lead": "Создано для",
      "storybook-status-bar-owner": "MetaFor",
      "storybook-status-bar-detail": "переиспользуемая WebGPU-инфраструктура UI",
    }))).toEqual({
      lead: "Создано для",
      owner: "MetaFor",
      detail: "переиспользуемая WebGPU-инфраструктура UI",
    })
    expect(() => readInjectedStorybookStatusBar(documentWithMeta({})))
      .toThrow("missing storybook-status-bar-lead meta")
  })
})
