import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {dirname} from "node:path"
import {randomUUID} from "node:crypto"
import type {StorybookCatalog} from "../catalog/catalog.t.ts"
import type {ExternalStorybookGraph} from "../catalog/graph.ts"

/** Stores former URLs across removal of their declarations; identities remain package names. */
export class StorybookPackageUrlMigrations {
  #entries: Map<string, string>

  constructor(private readonly path: string) {
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []
    if (!Array.isArray(value) || value.some(entry => !Array.isArray(entry) || entry.length !== 2 ||
      typeof entry[0] !== "string" || !/^\/(?:projects|workspaces)\/[^/]+\/$/u.test(entry[0]) || typeof entry[1] !== "string")) {
      throw new Error("Invalid Storybook URL migration history")
    }
    this.#entries = new Map(value)
  }

  remember(catalog: StorybookCatalog): void {
    const next = new Map(this.#entries)
    for (const scope of catalog.scopes) {
      if (scope.kind !== "package") continue
      for (const url of scope.legacyUrls ?? []) {
        const previous = next.get(url)
        if (previous !== undefined && previous !== scope.id) throw new Error(`Ambiguous former Storybook URL: ${url}`)
        next.set(url, scope.id)
      }
    }
    if (JSON.stringify([...next]) === JSON.stringify([...this.#entries])) return
    mkdirSync(dirname(this.path), {recursive: true, mode: 0o700})
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify([...next]), {flag: "wx", mode: 0o600})
      renameSync(temporary, this.path)
      this.#entries = next
    } finally { rmSync(temporary, {force: true}) }
  }

  resolve(pathname: string, graph: ExternalStorybookGraph): string | null {
    for (const [prefix, packageId] of this.#entries) {
      if (pathname !== prefix.slice(0, -1) && !pathname.startsWith(prefix)) continue
      let route = pathname.slice(prefix.length).replace(/\/$/u, "")
      if (route.startsWith("~directories/")) route = `dir-${route.slice("~directories/".length)}`
      const node = graph.nodes.find(node => node.packageId === packageId && node.routePath === route)
      return node?.urlPath ?? null
    }
    return null
  }
}
