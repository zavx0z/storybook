import {expect, test} from "bun:test"
import {mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {ExternalStorybookRegistry} from "./registry.ts"

test("обновляет ресурсы исходного обзора после изменения ссылок", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-resource-refresh-")))
  try {
    const entry = join(root, "index.ts")
    const oldDocument = join(root, "placement.md")
    const newDocument = join(root, "example.md")
    writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/resources", label: "Ресурсы"}))
    writeFileSync(entry, "/**\n[Размещение](placement.md)\n@packageDocumentation\n*/")
    writeFileSync(oldDocument, "# Размещение")
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    const initial = await registry.attach(root)
    expect(initial.descriptors[0]!.resourceFiles?.some(file => file.sourcePath === oldDocument)).toBe(true)

    writeFileSync(newDocument, "# Пример")
    writeFileSync(entry, "/**\n# Размещение\n\n[Пример](example.md)\n@packageDocumentation\n*/")
    unlinkSync(oldDocument)
    registry.markDirty(entry)
    const updated = await registry.refreshIfNeeded()
    expect(updated.graph.digest).not.toBe(initial.graph.digest)
    expect(updated.revision).toBeGreaterThan(initial.revision)
    const descriptor = updated.descriptors[0]!
    expect(descriptor.resourceFiles?.some(file => file.sourcePath === oldDocument)).toBe(false)
    expect(descriptor.resourceFiles?.some(file => file.sourcePath === newDocument)).toBe(true)
    expect(descriptor.watchedPaths).not.toContain(oldDocument)
    expect(descriptor.watchedPaths).toContain(newDocument)
    for (const file of descriptor.resourceFiles ?? []) expect(() => readFileSync(file.sourcePath)).not.toThrow()

    const unchanged = await registry.refresh()
    expect(unchanged.revision).toBe(updated.revision)
    expect(unchanged.descriptors).toBe(updated.descriptors)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
