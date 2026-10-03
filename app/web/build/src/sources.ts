import Environment from "@build/environment"
import {resolve} from "node:path"
import type {WebSources} from "../contract/sources"

/** Одна карта физических browser-входов, принадлежащих Web. */
export const sources: WebSources = Object.freeze({
  browserEntry: Environment.exactFile(resolve(import.meta.dir, "../../src/browser-entry.ts")),
  pageEntry: Environment.exactFile(resolve(import.meta.dir, "../../src/page-entry.ts")),
  packageEntry: Environment.exactFile(resolve(import.meta.dir, "../../page/package/index.ts")),
})
