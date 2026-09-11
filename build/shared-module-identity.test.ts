import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  storybookSharedBrowserIdentity,
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
