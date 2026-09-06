import {expect, test} from "bun:test"
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {readStorybookProjectSelection, writeStorybookProjectSelection} from "./project-store.ts"

test("configuration stores only ordered absolute paths, including an explicit empty selection", () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-config-"))
  const path = join(root, "config", "projects.json")
  try {
    expect(readStorybookProjectSelection(path)).toBeNull()
    const selected = [join(root, "second"), join(root, "first")]
    writeStorybookProjectSelection(path, selected)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(selected)
    expect(readStorybookProjectSelection(path)).toEqual(selected)
    writeStorybookProjectSelection(path, [])
    expect(readStorybookProjectSelection(path)).toEqual([])
    for (const invalid of [["relative"], ["/same", "/same"], {roots: ["/project"], label: "cached"}]) {
      writeFileSync(path, JSON.stringify(invalid))
      expect(() => readStorybookProjectSelection(path)).toThrow()
    }
  } finally { rmSync(root, {recursive: true, force: true}) }
})
