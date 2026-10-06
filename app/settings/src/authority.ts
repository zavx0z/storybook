import {createHash} from "node:crypto"
import {mkdir, realpath} from "node:fs/promises"
import {isAbsolute, join, relative, resolve, sep} from "node:path"
import {exclusive, readJson, save} from "./storage"

type Mode = "ask" | "scoped-autonomous"
type Policy = {schemaVersion: 1, revision: number, modes: Record<string, Mode>}

/** Полномочия человека хранятся вне дерева, доступного инструментам назначения. */
export function createAuthority(project: string, directory?: string) {
  const outside = (root: string, candidate: string) => {
    const path = relative(root, candidate)
    if (path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)) throw new TypeError("Политика подтверждений должна храниться вне Project")
  }
  if (directory !== undefined) {
    if (!isAbsolute(directory)) throw new TypeError("Каталог политики должен быть абсолютным")
    outside(resolve(project), resolve(directory))
  }
  const file = directory === undefined ? undefined : join(directory, createHash("sha256").update(resolve(project)).digest("hex"), "approvals.json")
  const validate = (value: unknown): Policy => {
    if (value === undefined) return {schemaVersion: 1, revision: 0, modes: {}}
    const data = value as Policy
    if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !data.modes || typeof data.modes !== "object" || Array.isArray(data.modes) ||
      Object.values(data.modes).some(mode => mode !== "ask" && mode !== "scoped-autonomous")) throw new TypeError("Повреждена доверенная политика подтверждений")
    return structuredClone(data)
  }
  const check = async () => {
    if (directory === undefined) return
    await mkdir(directory, {recursive: true, mode: 0o700})
    outside(await realpath(project), await realpath(directory))
  }
  return {
    enabled: file !== undefined,
    async read(): Promise<Policy> {
      await check()
      return validate(file === undefined ? undefined : await readJson(file))
    },
    async change(values: Readonly<Record<string, Mode | undefined>>): Promise<void> {
      if (file === undefined) {
        if (Object.values(values).some(value => value !== undefined)) throw new Error("Хранилище доверенной политики не подключено")
        return
      }
      await check()
      await exclusive(file, async () => {
        const policy = validate(await readJson(file))
        const previous = JSON.stringify(policy.modes)
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined) delete policy.modes[key]
          else if (value === "ask" || value === "scoped-autonomous") policy.modes[key] = value
          else throw new TypeError("Режим подтверждений не поддерживается")
        }
        if (JSON.stringify(policy.modes) === previous) return
        policy.revision += 1
        await save(file, policy)
      })
    },
  }
}

/** Editable defaults никогда не являются авторизацией, даже при известном значении. */
export function withoutApproval<T extends {approvalMode?: Mode}>(value: T): Omit<T, "approvalMode"> {
  const {approvalMode: _mode, ...rest} = value
  return rest
}
