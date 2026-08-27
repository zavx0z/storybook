import {describe, expect, test} from "bun:test"
import {
  STORYBOOK_SHELL_BACKGROUND_CSS,
  STORYBOOK_SHELL_BACKGROUND_RGBA,
} from "./shell-theme.ts"

describe("shared Storybook shell theme", () => {
  test("derives one opaque HTML and WebGPU background from Blender spaceNode roles", () => {
    expect(STORYBOOK_SHELL_BACKGROUND_RGBA).toEqual([29, 29, 29, 255])
    expect(STORYBOOK_SHELL_BACKGROUND_CSS).toBe("#1d1d1d")
  })
})
