import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
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
  test("admits only the exact README, declared resources and literal local assets", () => {
    const fixture = resourceFixture()
    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      readmePath: fixture.readme,
      declaredResources: [{path: fixture.reference}],
    })

    expect(allowList.resolveReadmeFile(fixture.readme)).toBe(fixture.readme)
    expect(allowList.resolveReadmeFile(fixture.asset)).toBe(fixture.asset)
    expect(allowList.resolveDeclaredResource(fixture.reference)).toBe(fixture.reference)
    expect(allowList.resolveReadmeFile(fixture.secret)).toBeNull()
    expect(allowList.resolveDeclaredResource(fixture.secret)).toBeNull()
    expect(allowList.resolveReadmeFile(fixture.reference)).toBeNull()
    expect(allowList.entries.every(Object.isFrozen)).toBeTrue()
    expect(Object.isFrozen(allowList.entries)).toBeTrue()
  })

  test("ignores external, missing, traversal and escaping symlink destinations", () => {
    const fixture = resourceFixture()
    const outside = join(fixture.root, "outside.txt")
    writeFileSync(outside, "outside\n")
    const escape = join(fixture.ownerRoot, "escape.txt")
    symlinkSync(outside, escape)
    writeFileSync(fixture.readme, [
      "[asset](./media/preview%20image.png)",
      "[outside](https://example.com/secret)",
      "[missing](./missing.txt)",
      "[parent](../outside.txt)",
      "[escape](./escape.txt)",
      "[query](./secret.txt?raw=1)",
    ].join("\n"))

    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      readmePath: fixture.readme,
    })
    expect(allowList.resolveReadmeFile(fixture.asset)).toBe(fixture.asset)
    expect(allowList.resolveReadmeFile(outside)).toBeNull()
    expect(allowList.resolveReadmeFile(escape)).toBeNull()
    expect(allowList.resolveReadmeFile(fixture.secret)).toBeNull()
  })

  test("fails closed if an allowed file is replaced by an escaping symlink", () => {
    const fixture = resourceFixture()
    const outside = join(fixture.root, "outside.txt")
    writeFileSync(outside, "outside\n")
    const allowList = createExternalStorybookResourceAllowList({
      ownerRoot: fixture.ownerRoot,
      readmePath: fixture.readme,
      declaredResources: [fixture.reference],
    })
    unlinkSync(fixture.reference)
    symlinkSync(outside, fixture.reference)
    expect(allowList.resolveDeclaredResource(fixture.reference)).toBeNull()
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
  const readme = join(ownerRoot, "README.md")
  const asset = join(ownerRoot, "media", "preview image.png")
  const reference = join(ownerRoot, "reference.png")
  const secret = join(ownerRoot, "secret.txt")
  writeFileSync(readme, "[preview](./media/preview%20image.png)\n")
  writeFileSync(asset, "png\n")
  writeFileSync(reference, "reference\n")
  writeFileSync(secret, "secret\n")
  return {
    root,
    ownerRoot: realpathSync(ownerRoot),
    readme: realpathSync(readme),
    asset: realpathSync(asset),
    reference: realpathSync(reference),
    secret: realpathSync(secret),
  }
}
