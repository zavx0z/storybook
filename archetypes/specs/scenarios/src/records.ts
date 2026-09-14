/** Сохраняет регистрацию групп и тестов без исполнения их проверок. @packageDocumentation */
import {serialize} from "./serialize"
import type {ScenarioGroup, ScenarioTest, TraceLocation, TraceValue} from "./types"

export interface Declaration {
  readonly site: string
  readonly location: TraceLocation
  readonly modifiers: readonly string[]
  readonly each: boolean
  readonly skipReason: string | null
  readonly assertions: ScenarioTest["assertions"]
}

export interface GroupContext {
  readonly describe: readonly string[]
  readonly test: string | null
  readonly groupId: number | null
  readonly testId: number | null
  readonly mode: "run" | "skip" | "todo"
  readonly skipReason: string | null
}

export const rootContext: GroupContext = {describe: [], test: null, groupId: null, testId: null, mode: "run", skipReason: null}
const declarations = new Map<string, Declaration>()
const conditions = new Map<string, Map<string, boolean>>()
const groups: {value: Omit<ScenarioGroup, "parameters">, parameters: Promise<TraceValue>}[] = []
const tests: ScenarioTest[] = []

export function declare(value: Declaration): void {
  declarations.set(value.site, value)
}

export function condition(site: string, name: string, value: unknown): unknown {
  let values = conditions.get(site)
  if (!values) conditions.set(site, values = new Map())
  values.set(name, Boolean(value))
  return value
}

export function mode(site: string, parent: GroupContext): GroupContext["mode"] {
  const modifiers = declarations.get(site)?.modifiers ?? []
  const values = conditions.get(site)
  if (parent.mode === "skip" || modifiers.includes("skip") || values?.get("skipIf")
    || (values?.has("if") && !values.get("if"))) return "skip"
  if (parent.mode === "todo" || modifiers.includes("todo") || values?.get("todoIf")) return "todo"
  return "run"
}

export function addGroup(site: string, label: string, parent: GroupContext, parameters: unknown): GroupContext {
  const declaration = declarations.get(site)
  if (!declaration) throw new Error(`Нет объявления группы ${site}`)
  const id = groups.length
  const selectedMode = mode(site, parent)
  const skipReason = declaration.skipReason ?? parent.skipReason
  groups.push({value: {id, parentId: parent.groupId, label, location: declaration.location, mode: selectedMode, skipReason}, parameters: serialize(parameters)})
  return {describe: [...parent.describe, label], test: null, groupId: id, testId: null, mode: selectedMode, skipReason}
}

export function addTest(declaration: Declaration, label: string, parent: GroupContext): ScenarioTest {
  declare(declaration)
  const selectedMode = mode(declaration.site, parent)
  const value: ScenarioTest = {
    id: tests.length,
    groupId: parent.groupId,
    label,
    location: declaration.location,
    mode: selectedMode,
    status: selectedMode === "skip" ? "skipped" : selectedMode === "todo" ? "todo" : "not-executed",
    message: null,
    skipReason: declaration.skipReason ?? parent.skipReason,
    assertions: declaration.assertions,
  }
  tests.push(value)
  return value
}

export async function readRecords() {
  return {
    groups: await Promise.all(groups.map(async group => ({...group.value, parameters: await group.parameters}))),
    tests,
  }
}
