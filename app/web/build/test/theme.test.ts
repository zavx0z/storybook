import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {readFileSync, realpathSync} from "node:fs"
import {join, resolve} from "node:path"
import {readWorkbenchStyleSheets} from "../src/theme"

test("оболочка принимает точный публичный CSS export темы корневого Immersive", () => {
  const toolRoot = resolve(import.meta.dir, "../../../..")
  const ownerRoot = realpathSync(join(toolRoot, "node_modules/@zavx0z/immersive"))
  const manifest = JSON.parse(readFileSync(join(ownerRoot, "package.json"), "utf8"))
  const path = realpathSync(resolve(ownerRoot, manifest.exports["./ui/theme.css"]))
  const sheets = readWorkbenchStyleSheets(toolRoot)
  expect(sheets).toEqual([{
    specifier: "@zavx0z/immersive/ui/theme.css",
    path,
    ownerRoot,
    ownerPackageJsonPath: join(ownerRoot, "package.json"),
    contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }])
})
