import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, readFileSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
import {readModuleDocumentation} from "@archetypes/package/documentation"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  createExternalStorybookResourceAllowList,
  localMarkdownDestinations,
} from "./resource-allowlist.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook resource allow-list", () => {
  test("admits only the exact code source and literal local assets", () => {
    const fixture = resourceFixture()
    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      sourcePath: fixture.source,
      markdown: documentation(fixture.source),
    })

    expect(allowList.resolveSourceFile(fixture.source)).toBe(fixture.source)
    expect(allowList.resolveAsset(fixture.asset)).toBe(fixture.asset)
    expect(allowList.resolveAsset(fixture.secret)).toBeNull()
    expect(allowList.resolveAsset(fixture.reference)).toBeNull()
    expect(allowList.resolveAsset(fixture.source)).toBeNull()
    expect(allowList.resolveSourceFile(fixture.asset)).toBeNull()
    expect(allowList.resolveAsset(join(fixture.ownerRoot, "README.md"))).toBeNull()
    expect(allowList.entries.every(Object.isFrozen)).toBeTrue()
    expect(Object.isFrozen(allowList.entries)).toBeTrue()
  })

  test("ignores external, missing, traversal and escaping symlink destinations", () => {
    const fixture = resourceFixture()
    const outside = join(fixture.root, "outside.txt")
    writeFileSync(outside, "outside\n")
    const escape = join(fixture.ownerRoot, "escape.txt")
    symlinkSync(outside, escape)
    writeFileSync(fixture.source, moduleSource([
      "[asset](./media/preview%20image.png)",
      "[outside](https://example.com/secret)",
      "[missing](./missing.txt)",
      "[parent](../outside.txt)",
      "[escape](./escape.txt)",
      "[query](./secret.txt?raw=1)",
    ].join("\n")))

    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      sourcePath: fixture.source,
      markdown: documentation(fixture.source),
    })
    expect(allowList.resolveAsset(fixture.asset)).toBe(fixture.asset)
    expect(allowList.resolveAsset(outside)).toBeNull()
    expect(allowList.resolveAsset(escape)).toBeNull()
    expect(allowList.resolveAsset(fixture.secret)).toBeNull()
  })

  test("fails closed if an allowed file is replaced by an escaping symlink", () => {
    const fixture = resourceFixture()
    const outside = join(fixture.root, "outside.txt")
    writeFileSync(outside, "outside\n")
    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      sourcePath: fixture.source,
      markdown: documentation(fixture.source),
    })
    unlinkSync(fixture.asset)
    symlinkSync(outside, fixture.asset)
    expect(allowList.resolveAsset(fixture.asset)).toBeNull()
  })

  test("does not derive an overview or assets from README when code documentation is absent", () => {
    const fixture = resourceFixture()
    const list = createExternalStorybookResourceAllowList({ownerRoot: fixture.ownerRoot, sourcePath: null, markdown: ""})
    expect(list.entries).toEqual([])
    expect(list.resolveAsset(fixture.secret)).toBeNull()
  })

  test("bounds the source and extracted text and rejects a replaced source", () => {
    const fixture = resourceFixture()
    expect(() => createExternalStorybookResourceAllowList({ownerRoot: fixture.ownerRoot, sourcePath: fixture.source, markdown: "", maxBytes: 1})).toThrow("source exceeds")
    expect(() => createExternalStorybookResourceAllowList({ownerRoot: fixture.ownerRoot, sourcePath: null, markdown: "long", maxBytes: 1})).toThrow("documentation exceeds")
    const list = createExternalStorybookResourceAllowList({ownerRoot: fixture.ownerRoot, sourcePath: fixture.source, markdown: documentation(fixture.source)})
    unlinkSync(fixture.source)
    symlinkSync(fixture.secret, fixture.source)
    expect(list.resolveSourceFile(fixture.source)).toBeNull()
    expect(() => createExternalStorybookResourceAllowList({ownerRoot: fixture.ownerRoot, sourcePath: fixture.source, markdown: "old snapshot"})).toThrow("must not be a symlink")
  })

  test("shares a bounded literal destination extractor", () => {
    expect(localMarkdownDestinations([
      "[doc](./DOC.md#section)",
      "![image](./media/image.png)",
      "[remote](https://example.com)",
      "[bad](javascript:alert(1))",
    ].join("\n"))).toEqual(["./DOC.md#section", "./media/image.png"])
  })

  test("admits an HTML image and a code-labelled link but no destinations from code or scripts", () => {
    expect(localMarkdownDestinations([
      '<div align="center"><img src="docs/img/metafor.gif" width="444" onerror="bad()"></div>',
      "",
      "[`docs/README.md`](docs/README.md)",
      "",
      "```html",
      '<img src="secret.txt">',
      "```",
      "",
      '<script><img src="private.txt"></script>',
    ].join("\n"))).toEqual(["docs/img/metafor.gif", "docs/README.md"])
  })
})

function resourceFixture() {
  const root = mkdtempSync(join(tmpdir(), "storybook-resource-allowlist-"))
  roots.push(root)
  const ownerRoot = join(root, "owner")
  mkdirSync(join(ownerRoot, "media"), {recursive: true})
  const source = join(ownerRoot, "index.ts")
  const asset = join(ownerRoot, "media", "preview image.png")
  const reference = join(ownerRoot, "reference.png")
  const secret = join(ownerRoot, "secret.txt")
  writeFileSync(source, moduleSource("[preview](./media/preview%20image.png)"))
  writeFileSync(join(ownerRoot, "README.md"), "[secret](./secret.txt)\n")
  writeFileSync(asset, "png\n")
  writeFileSync(reference, "reference\n")
  writeFileSync(secret, "secret\n")
  return {
    root,
    ownerRoot: realpathSync(ownerRoot),
    source: realpathSync(source),
    asset: realpathSync(asset),
    reference: realpathSync(reference),
    secret: realpathSync(secret),
  }
}

function moduleSource(markdown: string): string {
  return `/**\n${markdown}\n@packageDocumentation\n*/\nexport const value = true\n`
}

function documentation(path: string): string {
  return readModuleDocumentation({source: readFileSync(path, "utf8"), path})!.markdown
}
