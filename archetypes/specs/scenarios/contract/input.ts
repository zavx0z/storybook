/**
Входной контракт исполнения спецификации для сбора её структуры.

@property path - Путь к исполняемому файлу спецификации.

@property [lines] - Строки остановок с единицы в представлении инспектора.
Без указания запрашиваются остановки на всех строках выбранного файла.
*/
export interface ReadScenarioInput {
  readonly path: string
  readonly lines?: readonly number[]
}
