/**
Сценарий, по которому нужно показать структуру и правила написания.

@property path - Путь к spec/scenario.spec.ts либо spec/scenario.spec.tsx.
Относительный путь разрешается от рабочего каталога вызывающего процесса.
App читает и выполняет этот сценарий; Archetypes извлекает из отчёта руководство.
*/
export interface ReadScenarioGuideInput {
  readonly path: string
}
