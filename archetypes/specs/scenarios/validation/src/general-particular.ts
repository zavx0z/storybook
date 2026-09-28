import type {ValidateScenarioInput} from "../contract/input"
import type {ValidateScenarioOutput} from "../contract/output"

/** Общие проверки предшествуют необязательным частным группам второго уровня. */
export function generalParticular(source: ValidateScenarioInput["source"]): ValidateScenarioOutput["checks"][number] {
  type Registration = ValidateScenarioInput["source"]["registrations"][number]
  const issues: ValidateScenarioOutput["checks"][number]["issues"][number][] = []
  const parents: Registration[] = []
  const particularStarted = new Set<Registration>()
  const registrations = source.registrations
  for (const [index, item] of registrations.entries()) {
    while (parents.length && parents.at(-1)!.depth >= item.depth) parents.pop()
    const parent = parents.at(-1)
    const secondLevel = item.depth === 1 && parent?.depth === 0 && parent.modifiers.includes("each")
    const conditions = item.modifiers.filter(modifier => ["skipIf", "if", "todoIf"].includes(modifier))
    const particular = item.kind === "describe" && secondLevel && conditions.length === 1 && conditions[0] === "skipIf"
    const add = (message: string) => issues.push({message, location: item.location})

    if (item.scope === "indirect") add(`Объявление ${item.label} располагается непосредственно в describe; применимость частной темы задаётся describe.skipIf второго уровня`)
    if (conditions.length && !particular) add(`Частная тема ${item.label} оформляется describe.skipIf непосредственно внутри внешнего describe.each`)
    if (secondLevel) {
      if (particular) particularStarted.add(parent!)
      else if (!conditions.length && particularStarted.has(parent!)) add(`Общая проверка ${item.label} располагается перед частными группами describe.skipIf`)
    }
    if (particular) {
      let hasTests = false
      for (const child of registrations.slice(index + 1)) {
        if (child.depth <= item.depth) break
        if (child.kind === "test") { hasTests = true; break }
      }
      if (!hasTests) add(`Частная группа ${item.label} содержит проверки своей возможности; при отсутствии частных проверок группа не создаётся`)
    }
    if (item.kind === "describe") parents.push(item)
  }
  return {rule: "general-particular", status: issues.length ? "failed" : "passed", issues}
}
