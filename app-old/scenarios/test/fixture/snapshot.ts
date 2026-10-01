/**
Подготавливает сведения о снимке без регистрации групп, тестов и matchers.
Обход итеративный; служебные ссылки не раскрываются повторно.

@packageDocumentation
*/

/** Положение значения внутри закодированного снимка. */
type ValuePath = readonly (string | number)[]

/** Данные одной служебной метки без интерпретации пользовательского $type. */
interface Marker {
  readonly label: string
  readonly path: ValuePath
  readonly type: string
  readonly value: Record<string, unknown>
}

/**
Собирает служебные метки и проверяемые сведения о ссылках.

@param root - Корень одного снимка args, outcome.value либо outcome.error.
@returns Метки, экранированные объекты, сведения о разрешении ссылок и непереносимые значения.
Ожидаемые формы меток задаются в тесте readScenario независимо от этих данных.
*/
export function inspectSnapshot(root: unknown) {
  const markers: Marker[] = []
  const invalidValues: {path: ValuePath, reason: string}[] = []
  const nodes = new Map<string, unknown>()
  const dataLocations = new Set<string>()
  const queue = [{value: root, path: [] as ValuePath, literal: false, data: true}]
  const visited = new Set<object>()

  for (let index = 0; index < queue.length; index++) {
    const {value, path, literal, data} = queue[index]!
    nodes.set(JSON.stringify(path), value)
    if (data) dataLocations.add(JSON.stringify(path))
    if (value === null || typeof value === "string" || typeof value === "boolean") continue
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) continue
    if (typeof value !== "object" || value === null) {
      invalidValues.push({path, reason: "Значение не сохраняется обычным JSON"})
      continue
    }
    if (visited.has(value)) {
      invalidValues.push({path, reason: "Связь объектов не оформлена служебной ссылкой"})
      continue
    }
    visited.add(value)
    if (Array.isArray(value)) {
      for (let position = 0; position < value.length; position++) {
        queue.push({value: value[position], path: [...path, position], literal: false, data})
      }
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      invalidValues.push({path, reason: "Объект не приведён к переносимой форме"})
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const tag = descriptors.$type
    const markerType = !literal && tag && "value" in tag ? tag.value : undefined
    if (!literal && tag) {
      if (typeof markerType === "string") {
        markers.push({label: JSON.stringify(path), path, type: markerType, value: value as Record<string, unknown>})
      } else {
        invalidValues.push({path, reason: "Служебная метка не содержит строковый $type"})
      }
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue
      if (!("value" in descriptor)) {
        invalidValues.push({path: [...path, key], reason: "Accessor не оформлен служебной меткой"})
        continue
      }
      queue.push({
        value: descriptor.value,
        path: [...path, key],
        literal: !literal && markerType === "object" && key === "value",
        data: literal || (data && !tag) || (data && (
          (markerType === "promise" && (key === "value" || key === "error"))
          || (markerType === "unreadable" && key === "error")
          || (markerType === "matcher" && key === "args")
          || (markerType === "regexp" && (key === "lastIndex" || key === "properties"))
        )),
      })
    }
  }

  const references = markers.filter(marker => marker.type === "reference").map(marker => {
    const path = marker.value.path
    let target: unknown = root
    let resolved = Array.isArray(path)
    if (Array.isArray(path)) {
      for (const key of path) {
        const validKey = Array.isArray(target)
          ? typeof key === "number" && Number.isInteger(key) && key >= 0
          : typeof key === "string"
        if (!validKey || target === null || typeof target !== "object") {
          resolved = false
          break
        }
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          resolved = false
          break
        }
        target = descriptor.value
      }
    }
    const targetPath = Array.isArray(path) ? JSON.stringify(path) : ""
    const targetMarker = markers.find(item => item.label === targetPath)
    const objectMarker = targetMarker === undefined
      || ["object", "promise", "error", "date", "regexp", "unreadable", "matcher"].includes(targetMarker.type)
    const targetIsObject = resolved && dataLocations.has(targetPath) && nodes.has(targetPath) && target !== null
      && typeof target === "object" && objectMarker
    return {...marker, resolved, targetIsObject}
  })

  const escaped = markers.filter(marker => marker.type === "object")
  return {markers, references, escaped, invalidValues}
}
