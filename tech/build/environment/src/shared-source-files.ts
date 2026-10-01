import {createHash} from "node:crypto"
import {readFileSync, realpathSync} from "node:fs"
import type {StorybookSharedBrowserModule, StorybookSharedBrowserSourceFile} from "../contract/types"

/** Сохраняет одно source-свидетельство, когда native protocol и его owner используют один файл. */
export function sharedSourceFiles(modules: readonly StorybookSharedBrowserModule[]): readonly StorybookSharedBrowserSourceFile[] {
  return [...new Set(modules.map(({sourcePath}) => realpathSync(sourcePath)))].map(path => ({
    path,
    contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }))
}
