/**
Последовательно составляет два преобразования; первый участник сам является контейнером.
Потребитель получает результат целого, а не API его частей.

@packageDocumentation
*/
import adjust from "@fixture/compose-adjust"
import double from "@fixture/compose-double"
import type {FixtureCompose} from "./contract"

export type {FixtureCompose} from "./contract"

/** Передаёт выход вложенного контейнера следующему компоненту. */
export default function compose(value: FixtureCompose.Input): FixtureCompose.Output {
  return double(adjust(value))
}
