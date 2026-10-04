import type {StorybookSpecsScenariosReaderValidation} from "../contract"

/** Один авторский вызов при подготовке каждого конечного варианта, подтверждённый его запуском. */
export function singleInvocation(source: StorybookSpecsScenariosReaderValidation.Input["source"], execution?: StorybookSpecsScenariosReaderValidation.Input["execution"]): StorybookSpecsScenariosReaderValidation.Output["checks"][number] {
  const subject = source.subject
  const rule = "single-invocation"
  if (!subject) return {rule, status: "not-checked", issues: []}
  const declarations = source.registrations.filter(item => item.kind === "describe")
  const scopes = declarations.filter((item, index) => {
    if (!item.modifiers.includes("each")) return false
    for (const next of declarations.slice(index + 1)) {
      if (next.depth <= item.depth) break
      if (next.modifiers.includes("each")) return false
    }
    return true
  })
  const issues: StorybookSpecsScenariosReaderValidation.Output["checks"][number]["issues"][number][] = []
  if (!scopes.length) issues.push({
    message: `Сценарий ${subject.name} задаёт вариант each с единственным вызовом`,
    location: {path: source.path, line: 1, column: 1},
  })
  const matches = (left: {line: number; column: number} | null, right: {line: number; column: number}) =>
    left?.line === right.line && left.column === right.column
  for (const scope of scopes) {
    const calls = subject.calls.filter(call => matches(call.variant, scope.location))
    if (calls.length !== 1 || calls[0]!.test) issues.push({
      message: `Вариант each содержит один вызов ${subject.name} при подготовке, до test; в исходнике: ${calls.length}`,
      location: calls.at(-1)?.location ?? scope.location,
    })
  }
  for (const call of subject.calls.filter(call => !scopes.some(scope => matches(call.variant, scope.location)))) issues.push({
    message: `${subject.name} вызывается при подготовке конкретного варианта each`, location: call.location,
  })
  if (execution) {
    const groups = new Map(execution.groups.map(group => [group.id, group]))
    const belongsTo = (id: number | null, parent: number): boolean => {
      while (id !== null) {
        if (id === parent) return true
        id = groups.get(id)?.parentId ?? null
      }
      return false
    }
    const variants = execution.groups.filter(group => group.parameters !== null && group.parameters !== undefined
      && scopes.some(scope => matches(group.location, scope.location)))
    const calls = execution.calls.filter(call => call.location?.path === source.path && (subject.kind === "component"
      ? call.name.endsWith(".render") || call.name.endsWith(".renderComponent")
      : call.module === subject.module && call.name === subject.name))
    for (const variant of variants) {
      const observed = calls.filter(call => belongsTo(call.groupId, variant.id))
      if (observed.length !== 1 || observed[0]!.test !== null) issues.push({
        message: `Вариант «${variant.label}» выполняет один вызов ${subject.name} при подготовке, до test; в трассе: ${observed.length}`,
        location: observed.at(-1)?.location ?? variant.location,
      })
    }
    for (const call of calls.filter(call => !variants.some(variant => belongsTo(call.groupId, variant.id)))) issues.push({
      message: `${subject.name} вызывается в своём варианте each`, location: call.location,
    })
  }
  return {rule, status: issues.length ? "failed" : execution ? "passed" : "not-checked", issues}
}
