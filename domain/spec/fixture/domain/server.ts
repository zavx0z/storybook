/**
Изменяет значение счётчика, сохраняя исходный снимок.

@packageDocumentation
*/
import type {StorybookDomainSpecFixtureDomain} from "./contract/server"
export type {StorybookDomainSpecFixtureDomain} from "./contract/server"

/** Возвращает следующий снимок общей сущности. */
export default function advanceCounter({counter, step}: StorybookDomainSpecFixtureDomain.Input): StorybookDomainSpecFixtureDomain.Output {
  return {value: counter.value + step}
}
