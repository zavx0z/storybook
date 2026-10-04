import type {StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"

export declare namespace StorybookSpecsDocument {
  /**
  Наблюдения, из которых формируется руководство.

  @property report - Полный завершённый отчёт одного запуска сценария.
  */
  export interface Input {
    readonly report: StorybookSpecsScenariosReader.Output
  }

  /**
  Руководство по написанию сценария из его исходника и проверенных связей.

  @property kind - Признак предметного руководства для представления в App.

  @property files - Файлы примера с их ролью; первый файл является сценарием.

  @property examples - Полный исходник, затем код вариантов, вложенных тем, пунктов,
  связанных утверждений, явного состава объекта и обработки ресурсов.
  Выполненные значения функций, журналы и техническая трасса сюда не входят.

  @property checks - Результаты только реализованных правил оформления.
  Непроверенное правило остаётся явно непроверенным.
  */
  export interface Output {
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
}
