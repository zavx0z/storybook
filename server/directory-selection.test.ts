import {describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {StorybookDirectorySelection} from "./directory-selection.ts"

describe("browser directory proof", () => {
  test("binds a chosen folder by proof, rejects another session and prevents replay", () => {
    const base = mkdtempSync(join(tmpdir(), "storybook-directory-"))
    try {
      const first = join(base, "first")
      const second = join(base, "second")
      mkdirSync(first)
      mkdirSync(second)
      const selection = new StorybookDirectorySelection()
      const proof = selection.begin("registry-a")
      writeFileSync(join(second, proof.filename), proof.content)
      expect(() => selection.resolve(proof.token, "registry-b", base, [])).toThrow("недоступно")
      expect(selection.resolve(proof.token, "registry-a", base, [])).toEndWith("/second")
      expect(() => selection.resolve(proof.token, "registry-a", base, [])).toThrow("недоступно")
    } finally {
      rmSync(base, {recursive: true, force: true})
    }
  })

  test("does not substitute a folder when proof is missing or duplicated", () => {
    const base = mkdtempSync(join(tmpdir(), "storybook-directory-"))
    try {
      const selection = new StorybookDirectorySelection()
      const missing = selection.begin("registry")
      expect(() => selection.resolve(missing.token, "registry", base, [])).toThrow("однозначно")
      const child = join(base, "child")
      mkdirSync(child)
      const duplicate = selection.begin("registry")
      writeFileSync(join(base, duplicate.filename), duplicate.content)
      writeFileSync(join(child, duplicate.filename), duplicate.content)
      expect(() => selection.resolve(duplicate.token, "registry", base, [])).toThrow("однозначно")
    } finally {
      rmSync(base, {recursive: true, force: true})
    }
  })
})
