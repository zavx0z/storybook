import {type StorybookPackageStandard as PackageStandardContract} from "@zavx0z/storybook-package-standard"
type StorybookPackageVerification = NonNullable<Parameters<PackageStandardContract.Output["applied"]>[1]>
import type {StorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"

/** Вывод нормативного сценария; неизвестность сохраняет причину без назначения типа. */
type EntityTypeResult =
  | Readonly<{status: "confirmed", type: "Repo" | "Component" | "Container" | "Cluster" | "Domain"}>
  | Readonly<{status: "unknown", reason: "missing-report" | "stale-report" | "invalid-report" | "failed" | "incomplete" | "ambiguous"}>

/** Контракт нормативной проверки Package при подготовке ревизии. */
export declare namespace StorybookPackageBuildConformance {
  /**
  Запуск сценария и интерпретация исходного отчёта без изменения его фактов.

  @property check - Исполняет нормативный сценарий Package для выбранного владельца.

  @property verify - Оценивает полноту выполненных проверок с сохранением TODO и отказов.

  @property identify - Подтверждает тип по сохранённому отчёту нормативного сценария
  для указанного владельца: полное раскрытие exports, один кандидат в подтверждённом
  actual классификации и выполненные применимые проверки без ошибок и пропусков.
  Сохранённая прежняя форма сценария читается без повторной проверки исходников.
  TODO сохраняются в отчёте и не блокируют выбор типа. Имена сущностей, структура
  каталогов и отдельные успешные пункты не заменяют этот отчёт.
  */
  type Output = Readonly<{
    check(path: string, signal: AbortSignal): Promise<StorybookSpecsScenariosReader.Output>
    verify(report: StorybookSpecsScenariosReader.Output): StorybookPackageVerification
    identify(report: StorybookSpecsScenariosReader.Output, path: string): EntityTypeResult
  }>
}
