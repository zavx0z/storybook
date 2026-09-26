/**
Руководство по написанию сценария из его исходника и проверенных связей.

@property kind - Признак предметного руководства для представления в App.

@property files - Файлы примера с их ролью; первый файл является сценарием.

@property examples - Полный исходник, затем код варианта, пункта и обработки ресурсов.
Выполненные значения функций, журналы и техническая трасса сюда не входят.

@property checks - Результаты только реализованных правил оформления.
Непроверенное правило остаётся явно непроверенным.
*/
export interface ReadScenarioGuideOutput {
  readonly kind: "scenario-guide"
  readonly files: readonly {
    readonly path: string
    readonly role: "scenario" | "public-entry" | "contract" | "fixture"
  }[]
  readonly examples: readonly {
    readonly title: string
    readonly code: string
  }[]
  readonly checks: readonly {
    readonly rule: string
    readonly status: "passed" | "failed" | "not-checked"
    readonly issues: readonly string[]
  }[]
}
