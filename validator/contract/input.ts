/**
Выбор существующей спецификации и объекта её проверки.

@property path - Путь к реальному объекту проверки или существующей фикстуре.
@property specification - Файл тестов либо директория с непосредственными .spec.ts/.spec.tsx.
При выборе директории scenario.spec.ts(x) не включается; конкретный сценарий можно передать файлом.
@property pathVariable - Имя переменной окружения, которую читает выбранная спецификация.
Например, SPEC_DIRECTORY для содержимого spec или PACKAGE_PATH для пакета.
@property [testNamePattern] - Штатный фильтр имён Bun, включая имена групп.
@property [timeoutMs] - Ограничение времени дочернего процесса в миллисекундах.
*/
export interface ValidationInput {
  readonly path: string
  readonly specification: string
  readonly pathVariable: string
  readonly testNamePattern?: string
  readonly timeoutMs?: number
}
