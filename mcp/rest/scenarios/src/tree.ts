import type {ScenariosTreeOptions, ScenariosOutput, ScenariosTree} from "./types"

type Category = ScenariosOutput["variants"][number]
type Item = ScenariosOutput["items"][number]
type Group = NonNullable<ScenariosTree["variants"]>[number]
type TreeItem = NonNullable<ScenariosTree["items"]>[number]

/** Проекция сохраняет значения и принадлежность, не изменяя исходный отчёт. */
export function presentTree(data: ScenariosOutput, options: ScenariosTreeOptions): ScenariosTree {
  if (options.section?.length && options.variant === undefined) throw new Error("Для выбора темы сначала укажите вариант")
  const variants = options.variant === undefined ? data.variants : data.variants.filter(variant => variant.label === options.variant)
  if (options.variant !== undefined && variants.length !== 1) throw new Error("Вариант не найден или его имя неоднозначно")

  const item = (value: Item): TreeItem => ({
    label: value.label,
    status: value.status,
    ...(value.assertions.length ? {assertions: value.assertions.map(assertion => ({
      ...(assertion.customFailMessage === null ? {} : {customFailMessage: assertion.customFailMessage}),
      actual: structuredClone(assertion.actual),
      matcher: assertion.matcher,
      expected: structuredClone(assertion.expected),
      status: assertion.status,
      ...(assertion.modifiers.length ? {modifiers: [...assertion.modifiers]} : {}),
      ...(assertion.error === null ? {} : {error: structuredClone(assertion.error)}),
    }))} : {}),
    ...(value.unexecuted.length ? {unexecuted: value.unexecuted.map(assertion => ({
      customFailMessage: assertion.customFailMessage,
    }))} : {}),
    ...(value.message === null ? {} : {message: value.message}),
    ...(value.skipReason === null ? {} : {skipReason: value.skipReason}),
  })
  const group = (value: Category, path: readonly string[] = []): Group => {
    let children = value.categories
    if (path.length) {
      children = value.categories.filter(child => child.label === path[0])
      if (children.length !== 1) throw new Error("Тема не найдена или её имя неоднозначно")
    }
    return {
      label: value.label,
      ...(value.parameters === null ? {} : {parameters: structuredClone(value.parameters)}),
      ...(children.length ? {children: children.map(child => group(child, path.slice(1)))} : {}),
      ...(!path.length && value.items.length ? {items: value.items.map(item)} : {}),
    }
  }
  return {
    status: data.status,
    ...(variants.length ? {variants: variants.map(variant => group(variant, options.section))} : {}),
    ...(options.variant === undefined && data.items.length ? {items: data.items.map(item)} : {}),
  }
}
