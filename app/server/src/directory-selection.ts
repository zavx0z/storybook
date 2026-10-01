import {randomBytes, randomUUID} from "node:crypto"
import {lstatSync, readFileSync, readdirSync, realpathSync} from "node:fs"
import {join} from "node:path"

/** Подтверждения привязаны к registry session; сервер только читает выбранную метку. */
export class StorybookDirectorySelection {
  readonly #pending = new Map<string, {session: string; content: string; expires: number}>()
  readonly #knownDirectories = new Set<string>()

  /** Keep only previously declared locations for proof lookup during this server session. */
  remember(directories: readonly string[]): void {
    for (const directory of directories) this.#knownDirectories.add(directory)
  }

  begin(session: string): Readonly<{token: string; filename: string; content: string}> {
    for (const [token, item] of this.#pending) if (item.expires < Date.now()) this.#pending.delete(token)
    if (this.#pending.size >= 32) throw new Error("Слишком много незавершённых выборов папки")
    const token = randomUUID()
    const content = randomBytes(32).toString("hex")
    this.#pending.set(token, {session, content, expires: Date.now() + 60_000})
    return Object.freeze({token, filename: `.storybook-selection-${token}`, content})
  }

  resolve(token: string, session: string, directory: string, knownRoots: readonly string[]): string {
    const pending = this.#pending.get(token)
    if (pending === undefined || pending.session !== session || pending.expires < Date.now()) {
      throw new Error("Подтверждение выбранной папки недоступно или истекло")
    }
    this.#pending.delete(token)
    const base = realpathSync.native(directory)
    const candidates = [base, ...knownRoots, ...this.#knownDirectories, ...readdirSync(base, {withFileTypes: true})
      .filter(entry => entry.isDirectory()).map(entry => join(base, entry.name))]
    const matches = new Set<string>()
    for (const candidate of candidates) {
      const path = join(candidate, `.storybook-selection-${token}`)
      try {
        const stat = lstatSync(path)
        if (!stat.isFile() || stat.size !== pending.content.length) continue
        if (readFileSync(path, "utf8") === pending.content) matches.add(realpathSync.native(candidate))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    if (matches.size !== 1) throw new Error(`Выберите папку проекта внутри ${base}. Не удалось однозначно связать выбранную папку с сервером.`)
    return [...matches][0]!
  }
}
