/**
Входной контракт построения адреса структурного узла.

@property node - Канонический путь из декодированных сегментов без ведущего `/`.

@property [view=overview] - Выбранное представление владельца. `overview`
не добавляется в query.

@property [variant] - Необязательный вариант, добавляемый в query.
*/
export interface FormatRouteAddressInput {
  readonly node: string
  readonly view?: "overview" | "scenarios" | "contract" | "dependencies"
  readonly variant?: string
}
