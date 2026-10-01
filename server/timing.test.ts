import {describe, expect, test} from "bun:test"
import {
  STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS,
  STORYBOOK_SHARED_COMPILE_TIMEOUT_MS,
  STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS,
} from "./timing.ts"

describe("external Storybook timing boundaries", () => {
  test("keeps the bounded server transport alive through package compile cleanup", () => {
    expect(STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS * 1_000)
      .toBeGreaterThan(STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)
    expect(STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255)
  })
  test("общая сборка kernel и host имеет отдельный конечный бюджет", () => {
    expect(STORYBOOK_SHARED_COMPILE_TIMEOUT_MS).toBe(480_000)
    expect(STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS).toBe(120_000)
  })
})
