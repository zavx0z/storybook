import {createHash} from "node:crypto"
import {describe, expect, test} from "bun:test"
import {sha256Hex} from "./sha256.ts"

describe("browser-safe SHA-256", () => {
  test("matches the canonical implementation for UTF-8 and multi-block input", () => {
    for (const value of ["", "abc", "Storybook · проверка", "0123456789".repeat(10_000)]) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value).digest("hex"))
    }
  })
})
