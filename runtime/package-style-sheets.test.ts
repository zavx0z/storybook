import {Event, createDocument} from "@zavx0z/dom"
import {describe, expect, test} from "bun:test"
import {createStorybookPackageStyleSheetOwner} from "./package-style-sheets.ts"
import type {ExternalStorybookShell} from "./shell.ts"

describe("Storybook package stylesheet owner", () => {
  test("prepares without applying and restores the previous semantic links after rollback", async () => {
    const document = createDocument()
    const html = document.createElement("html")
    document.append(html)
    document.subscribeMutations(batch => {
      for (const record of batch.records) {
        if (record.type !== "childList") continue
        for (const node of record.addedNodes) {
          if ((node as {localName?: string}).localName === "link") {
            queueMicrotask(() => node.dispatchEvent(new Event("load")))
          }
        }
      }
    })
    const owner = createStorybookPackageStyleSheetOwner({document} as ExternalStorybookShell, 1_000)
    const first = await owner.prepare("/revision-a/", [{
      specifier: "@fixture/a/theme.css",
      url: "assets/theme-a.css",
      contentDigest: "a".repeat(64),
    }], new AbortController().signal)
    expect(document.querySelectorAll("link")).toHaveLength(0)
    await first.commit()
    first.release()
    expect(document.querySelector("link")?.getAttribute("href")).toBe("/revision-a/assets/theme-a.css")

    const second = await owner.prepare("/revision-b/", [{
      specifier: "@fixture/b/theme.css",
      url: "assets/theme-b.css",
      contentDigest: "b".repeat(64),
    }], new AbortController().signal)
    expect(document.querySelectorAll("link")).toHaveLength(1)
    await second.commit()
    expect(document.querySelectorAll("link")).toHaveLength(1)
    expect(document.querySelector("link")?.getAttribute("href")).toBe("/revision-b/assets/theme-b.css")

    await second.rollback()
    expect(document.querySelectorAll("link")).toHaveLength(1)
    expect(document.querySelector("link")?.getAttribute("href")).toBe("/revision-a/assets/theme-a.css")
    owner.clear()
    expect(document.querySelectorAll("link")).toHaveLength(0)
  })
})
