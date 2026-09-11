import {expect, test} from "bun:test"
import {mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations.ts"
import {ExternalStorybookRegistry} from "./registry.ts"

test("обновляет ресурсы README при прежнем графе после добавления и удаления ссылки", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-resource-refresh-")))
  try {
    const readme = join(root, "README.md")
    const oldDocument = join(root, "placement.md")
    const newDocument = join(root, "example.md")
    writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/resources", label: "Ресурсы"}))
    writeFileSync(readme, "[Размещение](placement.md)")
    writeFileSync(oldDocument, "# Размещение")
    const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
    const initial = await registry.attach(root)
    const initialRebuilds = registry.metrics().graphRebuilds
    expect(initial.descriptors[0]!.resourceFiles?.some(file => file.sourcePath === oldDocument)).toBe(true)

    writeFileSync(newDocument, "# Пример")
    writeFileSync(readme, "# Размещение\n\n[Пример](example.md)")
    unlinkSync(oldDocument)
    registry.markDirty(readme)
    const updated = await registry.refreshIfNeeded()
    expect(updated.graph.digest).toBe(initial.graph.digest)
    expect(updated.revision).toBeGreaterThan(initial.revision)
    const descriptor = updated.descriptors[0]!
    expect(descriptor.resourceFiles?.some(file => file.sourcePath === oldDocument)).toBe(false)
    expect(descriptor.resourceFiles?.some(file => file.sourcePath === newDocument)).toBe(true)
    expect(descriptor.watchedPaths).not.toContain(oldDocument)
    expect(descriptor.watchedPaths).toContain(newDocument)
    for (const file of descriptor.resourceFiles ?? []) expect(() => readFileSync(file.sourcePath)).not.toThrow()
    expect(registry.metrics().graphRebuilds).toBe(initialRebuilds)

    const unchanged = await registry.refresh()
    expect(unchanged.revision).toBe(updated.revision)
    expect(unchanged.descriptors).toBe(updated.descriptors)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
