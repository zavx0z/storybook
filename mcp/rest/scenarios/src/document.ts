import type {ScenariosDocumentOptions, ScenariosOutput, ScenariosDocument, ScenarioContent, ScenarioSection} from "./types"

type Category = ScenariosOutput["variants"][number]
type Item = ScenariosOutput["items"][number]

/** Упорядочивает разделы и абзацы по положению в исходнике, сохраняя порядок совпадающих позиций. */
function inSourceOrder<T extends {location: {line: number, column: number} | null}>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => (left.location?.line ?? Infinity) - (right.location?.line ?? Infinity)
    || (left.location?.column ?? Infinity) - (right.location?.column ?? Infinity))
}

/** Строит предметную документацию из подготовленных данных без знания конкретной функции или компонента. */
export function presentDocument(data: ScenariosOutput, options: ScenariosDocumentOptions): ScenariosDocument {
  if (options.section?.length && options.variant === undefined) throw new Error("Для выбора темы сначала укажите вариант")
  const variants = options.variant === undefined ? data.variants : data.variants.filter(variant => variant.label === options.variant)
  if (options.variant !== undefined && variants.length !== 1) throw new Error("Вариант не найден или его имя неоднозначно")

  const item = (value: Item): ScenarioSection => {
    const content = inSourceOrder([
      ...value.assertions.map(assertion => ({
        location: assertion.location,
        paragraph: {
          ...(assertion.customFailMessage === null ? {} : {text: assertion.customFailMessage}),
          value: structuredClone(assertion.actual),
        } as ScenarioContent,
      })),
      ...value.unexecuted.filter(assertion => assertion.customFailMessage !== null).map(assertion => ({
        location: assertion.location,
        paragraph: {text: assertion.customFailMessage!} as ScenarioContent,
      })),
    ]).map(entry => entry.paragraph)
    const notes: string[] = []
    if (value.status === "todo") notes.push("Этот раздел ещё требует подтверждения.")
    else if (value.status === "skipped") notes.push(value.skipReason ?? "Пример не выполнен в выбранных условиях.")
    else if (value.status === "not-executed") notes.push("Пример ещё не выполнен.")
    else if (value.status === "failed" || value.status === "error") notes.push("Пример завершился ошибкой; описанный результат не подтверждён.")
    else if (value.assertions.some(assertion => assertion.status === "failed")) notes.push("Пример показывает ожидаемое несоответствие условию.")
    return {
      title: value.label,
      ...(content.length ? {content} : {}),
      ...(notes.length ? {notes} : {}),
    }
  }
  const sections = (categories: readonly Category[], items: readonly Item[]): ScenarioSection[] => inSourceOrder([
    ...categories.map(value => ({location: value.location, section: group(value)})),
    ...items.map(value => ({location: value.location, section: item(value)})),
  ]).map(value => value.section)
  const group = (value: Category, path: readonly string[] = []): ScenarioSection => {
    const preview = data.preview?.variants.find(variant => variant.id === String(value.id))
    const content: ScenarioContent[] = preview === undefined ? [] : [
      {text: "Декларация компонента", value: preview.source},
      {text: "Конкретные props варианта", value: structuredClone(preview.props)},
      {text: "Пункты представления", value: structuredClone(preview.points)},
    ]
    if (path.length) {
      const selected = [...value.categories, ...value.items].filter(child => child.label === path[0])
      if (selected.length !== 1) throw new Error("Тема не найдена или её имя неоднозначно")
      const child = selected[0]!
      if ("categories" in child) return {title: value.label, ...(content.length ? {content} : {}), sections: [group(child, path.slice(1))]}
      if (path.length !== 1) throw new Error("Тема не найдена или её имя неоднозначно")
      return {title: value.label, ...(content.length ? {content} : {}), sections: [item(child)]}
    }
    const children = sections(value.categories, value.items)
    return {title: value.label, ...(content.length ? {content} : {}), ...(children.length ? {sections: children} : {})}
  }
  if (data.status !== "ready") return {notes: [data.status === "absent" ? "Документация сценария отсутствует." : "Документация сценария ещё не подготовлена."]}
  const content = options.variant === undefined ? sections(variants, data.items) : variants.map(variant => group(variant, options.section))
  return {
    ...(content.length ? {sections: content} : {}),
    ...(data.validation?.status === "failed" ? {notes: ["В оформлении или выполнении сценария обнаружены нарушения. Подробности доступны в диагностике."]} : {}),
  }
}
