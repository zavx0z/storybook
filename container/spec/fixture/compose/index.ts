/**
Последовательно составляет два преобразования; первый участник сам является контейнером.
Потребитель получает результат целого, а не API его частей.

@packageDocumentation
*/
import adjust from "./adjust/index.ts"
import double from "./double/index.ts"
import type {Input} from "./contract/input"
import type {Output} from "./contract/output"

export type {Input, Output}

/** Передаёт выход вложенного контейнера следующему компоненту. */
export default function compose(value: Input): Output {
  return double(adjust(value))
}
