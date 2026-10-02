import {realpathSync} from "node:fs"
import {resolve} from "node:path"
import type {WebSources} from "../contract/sources"

/** Одна карта физических browser-входов, принадлежащих Web. */
export const sources: WebSources = Object.freeze({
  browserEntry: realpathSync(resolve(import.meta.dir, "../../page/src/browser-entry.ts")),
  pageEntry: realpathSync(resolve(import.meta.dir, "../../page/index.ts")),
  packageEntry: realpathSync(resolve(import.meta.dir, "../../page/package/index.ts")),
  homeEntry: realpathSync(resolve(import.meta.dir, "../../page/home/index.ts")),
  sharedBootstrap: realpathSync(resolve(import.meta.dir, "../../bootstrap/src/browser-entry.ts")),
})
