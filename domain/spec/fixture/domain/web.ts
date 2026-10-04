/**
Показывает значение счётчика в текстовом представлении.

@packageDocumentation
*/
import type {StorybookDomainSpecFixtureDomain} from "./contract/web"
export type {StorybookDomainSpecFixtureDomain} from "./contract/web"

/** Общая величина сохраняется; представление добавляет только подпись. */
export default function showCounter({counter, prefix = ""}: StorybookDomainSpecFixtureDomain.Input): StorybookDomainSpecFixtureDomain.Output {
  return `${prefix}${counter.value}`
}
