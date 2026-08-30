import {describe, expect, test} from "bun:test"
import {mergeStorybookAuthorStyleSheets} from "./author-style-sheets.ts"

const digest = (character: string): string => character.repeat(64)

describe("Storybook author stylesheet composition", () => {
  test("keeps Workbench first and collapses the same active public resource", () => {
    const theme = Object.freeze({
      specifier: "@ui/components/theme.css",
      contentDigest: digest("a"),
      url: "workbench-author-style-sheets/0.css",
    })
    const owner = Object.freeze({
      specifier: "@owner/package.css",
      contentDigest: digest("b"),
      url: "author-style-sheets/1.css",
    })
    expect(mergeStorybookAuthorStyleSheets(
      [theme],
      [{...theme, url: "author-style-sheets/0.css"}, owner],
    )).toEqual([theme, owner])
  })

  test("fails closed when the same public specifier resolves to different bytes", () => {
    expect(() => mergeStorybookAuthorStyleSheets(
      [{specifier: "@ui/components/theme.css", contentDigest: digest("a")}],
      [{specifier: "@ui/components/theme.css", contentDigest: digest("b")}],
    )).toThrow("Conflicting Storybook author stylesheet content")
  })
})
