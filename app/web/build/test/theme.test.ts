import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {readFileSync, realpathSync} from "node:fs"
import {join, resolve} from "node:path"
import {readWorkbenchStyleSheets} from "../src/theme"

test("оболочка принимает публичную тему UI после переноса в theme", () => {
  const toolRoot = resolve(import.meta.dir, "../../../..")
  const ownerRoot = realpathSync(join(toolRoot, "../immersive/ui"))
  const path = join(ownerRoot, "theme/theme.css")
  const sheets = readWorkbenchStyleSheets(toolRoot)
  expect(sheets).toEqual([{
    specifier: "@immersive-ui/component/theme/theme.css",
    path,
    ownerRoot,
    ownerPackageJsonPath: join(ownerRoot, "package.json"),
    contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }])
})
