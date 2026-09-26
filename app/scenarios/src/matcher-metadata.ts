const matchers = new WeakMap<object, {name: string, modifiers: readonly string[], args: readonly unknown[]}>()

/** Сохраняет аргументы фабрики асимметричного matcher, оставляя native объект без изменений. */
export function observeMatcher(name: string, modifiers: readonly string[], original: (...args: unknown[]) => unknown) {
  return (...args: unknown[]) => {
    const result = Reflect.apply(original, undefined, args)
    if (typeof result === "object" && result !== null) matchers.set(result, {name, modifiers, args})
    return result
  }
}

export function matcherMetadata(value: object) {
  return matchers.get(value)
}
