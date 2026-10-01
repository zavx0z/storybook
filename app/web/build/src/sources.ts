import {realpathSync} from "node:fs"
import {resolve} from "node:path"
import type {WebSources} from "../contract/sources"

/** Одна карта физических browser-входов, принадлежащих Web. */
export const sources: WebSources = Object.freeze({
  browserEntry: realpathSync(resolve(import.meta.dir, "../../src/runtime/browser-entry.ts")),
  pageEntry: realpathSync(resolve(import.meta.dir, "../../src/runtime/page-entry.ts")),
  packageEntry: realpathSync(resolve(import.meta.dir, "../../src/runtime/package-entry.ts")),
  homeEntry: realpathSync(resolve(import.meta.dir, "../../src/runtime/home-entry.ts")),
  sharedBootstrap: realpathSync(resolve(import.meta.dir, "../../src/runtime/shared-bootstrap.ts")),
})
