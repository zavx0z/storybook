import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  storybookSharedBrowserIdentity,
  createStorybookSharedBrowserExternalPlugin,
  validateStorybookSharedBrowserIdentity,
} from "./shared-module-identity.ts"

const HOST_MODULE_EPOCH = "a".repeat(64)

test("изменение host entry не создаёт новую эпоху модулей платформы", () => {
  const sourcePath = realpathSync(join(import.meta.dir, "../node_modules/@zavx0z/dom/src/index.ts"))
  const modules = [{
    specifier: "@zavx0z/dom",
    sourcePath,
    url: "/__storybook/shared/kernel/dom-a.js",
  }]
  const before = storybookSharedBrowserIdentity(
    "/__storybook/shared/entries/package-entry-a.js",
    modules,
    HOST_MODULE_EPOCH,
  )
  const after = storybookSharedBrowserIdentity(
    "/__storybook/shared/entries/package-entry-b.js",
    modules,
    HOST_MODULE_EPOCH,
  )
  const platformChange = storybookSharedBrowserIdentity(
    after.packageEntryUrl,
    [{...modules[0]!, url: "/__storybook/shared/kernel/dom-b.js"}],
    HOST_MODULE_EPOCH,
  )

  expect(after.epoch).toBe(before.epoch)
  expect(platformChange.epoch).not.toBe(before.epoch)
})

test("устаревшее evidence исходников kernel отклоняется до сборки пакета", () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-kernel-evidence-"))
  try {
    const evidence = join(root, "kernel.ts")
    writeFileSync(evidence, "export const value = 'before'\n")
    const sourcePath = realpathSync(join(import.meta.dir, "../node_modules/@zavx0z/dom/src/index.ts"))
    const identity = storybookSharedBrowserIdentity(
      "/__storybook/shared/entries/package-entry.js",
      [{specifier: "@zavx0z/dom", sourcePath, url: "/__storybook/shared/kernel/dom.js"}],
      HOST_MODULE_EPOCH,
      [
        {
          path: sourcePath,
          contentDigest: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
        },
        {
          path: evidence,
          contentDigest: createHash("sha256").update("export const value = 'before'\n").digest("hex"),
        },
      ],
    )
    writeFileSync(evidence, "export const value = 'after'\n")

    expect(() => validateStorybookSharedBrowserIdentity(identity)).toThrow(
      "source changed after kernel build",
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test.each(["@retired-platform/component", "@jsx-runtime/create"])("Снимок направляет %s в сохранённый модуль без текущей реализации", async specifier => {
  const root = mkdtempSync(join(tmpdir(), "storybook-archived-import-"))
  try {
    const sourcePath = join(root, "removed-source.ts")
    const identity = storybookSharedBrowserIdentity(
      "/__storybook/shared/entries/package.js",
      [{specifier, sourcePath, url: "/__storybook/shared/kernel/retained.js"}],
      HOST_MODULE_EPOCH,
      [{path: sourcePath, contentDigest: "0".repeat(64)}],
      undefined,
      false,
    )
    const entry = join(root, "entry.ts")
    writeFileSync(entry, `export {default} from ${JSON.stringify(specifier)}\n`)
    const result = await Bun.build({entrypoints: [entry], target: "browser", metafile: true,
      plugins: [createStorybookSharedBrowserExternalPlugin(identity, false)]})
    expect(result.success).toBeTrue()
    expect(await result.outputs[0]!.text()).toContain("/__storybook/shared/kernel/retained.js")
    expect(Object.keys(result.metafile!.inputs)).toHaveLength(1)
    expect(() => validateStorybookSharedBrowserIdentity({...identity,
      modules: [{...identity.modules[0]!, url: "/__storybook/shared/kernel/replaced.js"}],
    }, false)).toThrow("does not match its epoch")
    expect(() => validateStorybookSharedBrowserIdentity({...identity,
      modules: [{...identity.modules[0]!, specifier: "../outside"}],
    }, false)).toThrow("Unknown shared")
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
