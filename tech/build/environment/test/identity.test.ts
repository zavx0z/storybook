import {expect, test} from "bun:test"
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Environment from "@zavx0z/storybook-tech-build-environment"

const HOST_MODULE_EPOCH = "a".repeat(64)

test("изменение host entry не создаёт новую эпоху модулей платформы", () => {
  const sourcePath = realpathSync(join(import.meta.dir, "../../../../node_modules/@zavx0z/immersive-dom/src/index.ts"))
  const modules = [{specifier: "@zavx0z/immersive-dom", sourcePath, url: "/__storybook/shared/kernel/dom-a.js"}]
  const before = Environment.identity("/__storybook/shared/entries/package-entry-a.js", modules, HOST_MODULE_EPOCH)
  const after = Environment.identity("/__storybook/shared/entries/package-entry-b.js", modules, HOST_MODULE_EPOCH)
  const platformChange = Environment.identity(after.packageEntryUrl,
    [{...modules[0]!, url: "/__storybook/shared/kernel/dom-b.js"}], HOST_MODULE_EPOCH)
  expect(after.epoch).toBe(before.epoch)
  expect(platformChange.epoch).not.toBe(before.epoch)
})

test("правка и удаление источника не отменяют опубликованную таблицу модулей", () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-published-module-"))
  try {
    const sourcePath = join(root, "kernel.ts")
    writeFileSync(sourcePath, "export const value = 'before'")
    const identity = Environment.identity("/__storybook/shared/entries/package.js",
      [{specifier: "@zavx0z/immersive-dom", sourcePath, url: "/__storybook/shared/kernel/dom.js"}], HOST_MODULE_EPOCH)
    writeFileSync(sourcePath, "export const value = 'after'")
    expect(Environment.validate(identity)).toEqual(identity)
    rmSync(sourcePath)
    expect(Environment.validate(identity)).toEqual(identity)
    const legacy = {...identity, sourceFiles: [{path: sourcePath, contentDigest: "0".repeat(64)}]}
    expect(Environment.validate(legacy), "Старая source metadata не читается и не переносится в нормализованную identity").toEqual(identity)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test.each(["@retired-platform/component", "@zavx0z/immersive-jsx-runtime-create"])("Снимок направляет %s в сохранённый модуль без текущей реализации", async specifier => {
  const root = mkdtempSync(join(tmpdir(), "storybook-archived-import-"))
  try {
    const sourcePath = join(root, "removed-source.ts")
    const identity = Environment.identity("/__storybook/shared/entries/package.js",
      [{specifier, sourcePath, url: "/__storybook/shared/kernel/retained.js"}], HOST_MODULE_EPOCH)
    const entry = join(root, "entry.ts")
    writeFileSync(entry, `export {default} from ${JSON.stringify(specifier)}\n`)
    const result = await Bun.build({entrypoints: [entry], target: "browser", metafile: true,
      plugins: [Environment.externalPlugin(identity)]})
    expect(result.success).toBeTrue()
    expect(await result.outputs[0]!.text()).toContain("/__storybook/shared/kernel/retained.js")
    expect(Object.keys(result.metafile!.inputs)).toHaveLength(1)
    expect(() => Environment.validate({...identity,
      modules: [{...identity.modules[0]!, url: "/__storybook/shared/kernel/replaced.js"}],
    })).toThrow("does not match its epoch")
    expect(() => Environment.validate({...identity,
      modules: [{...identity.modules[0]!, specifier: "../outside"}],
    })).toThrow("Unknown shared")
  } finally { rmSync(root, {recursive: true, force: true}) }
})
