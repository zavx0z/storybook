/** Подготавливает однозначные структурные preview-сценарии пакетной ревизии.

@packageDocumentation
*/
import PackageSessionOwner, {type Zavx0zStorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import {type Zavx0zStorybookPackageStandard as PackageStandardContract} from "@zavx0z/storybook-package-standard"
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
type Zavx0zStorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
type Zavx0zStorybookPackageStandard = ReturnType<PackageStandardContract.Output["applied"]>
import readScenario, {type Zavx0zStorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"
import conformance from "@zavx0z/storybook-package-build-conformance"
import inputs from "@zavx0z/storybook-package-build-inputs"
import type {Zavx0zStorybookPackageBuildLoader} from "@zavx0z/storybook-package-build-loader"
import type {Zavx0zStorybookPackageBuildScenarios} from "./contract"

export type {Zavx0zStorybookPackageBuildScenarios} from "./contract"

type ReadScenarioOutput = Zavx0zStorybookSpecsScenariosReader.Output
type StorybookGeneratedScenario = Parameters<Zavx0zStorybookPackageBuildLoader.Output["generateJsxModules"]>[0][number]
const {stablePath: stableBuildInputPath} = inputs
const {verify: scenarioVerification} = conformance

/**
Подготавливает однозначные preview-сценарии текущей package revision.

Статический probe не исполняет Bun Test. Собственные сценарии выполняются здесь один раз; нормативные сценарии
проверяются отдельно тем же App. Технический отказ
блокирует оба режима. Нарушение авторства переходного пакета даёт предупреждение
и отсутствие preview; строгий пакет требует поддержанного представления.
Полный отчёт сохраняется отдельно от браузерного модуля.
*/
export default async function prepareStorybookScenarios(
  descriptor: Zavx0zStorybookPackageBuildDescriptor,
  signal: AbortSignal,
  onPrepared?: (nodeId: string, result: ReadScenarioOutput) => void,
  policy: Readonly<{standard: Zavx0zStorybookPackageStandard, warnings: StorybookPackageDiagnostic[]}> = {standard: "strict", warnings: []},
  onProgress?: Zavx0zStorybookSpecsScenariosReader.Input["onProgress"],
): Promise<readonly StorybookGeneratedScenario[]> {
  const prepared: StorybookGeneratedScenario[] = []
  const read = (path: string) => readScenario({path, signal, ...(onProgress === undefined ? {} : {onProgress})})
  const authoring = (message: string, path: string): void => {
    if (policy.standard === "strict") throw storybookBuildError(storybookDiagnostic("validate", message, path))
    policy.warnings.push(storybookDiagnostic("validate", message, path))
  }
  const verify = (report: ReadScenarioOutput): void => {
    assertScenarioExecution(report)
    const result = scenarioVerification(report)
    if (result.status !== "passed") authoring(result.diagnostics.map(item => item.message).join("\n"), report.path)
  }
  for (const spec of descriptor.scenarioSpecs ?? []) {
    if (spec.sourcePaths.length !== 1) {
      if (spec.sourcePaths.length) authoring("Нет однозначного исполняемого preview: указан более чем один сценарий", spec.sourcePaths[0]!)
      continue
    }
    const supported: string[] = []
    let structuralReport = false
    for (const path of spec.sourcePaths) {
      signal.throwIfAborted()
      try {
        if (await readScenario.supportsPreview({path})) supported.push(path)
        else {
          const report = await read(path)
          verify(report)
          onPrepared?.(spec.nodeId, report)
          structuralReport = report.source.subject === null
        }
      } catch (error) {
        if (!(readScenario.isAuthoringError(error))) throw error
        if (policy.standard === "strict") throw error
        // Нарушение оформления не скрывает ошибку исполнения того же сценария.
        const report = await read(path)
        verify(report)
        onPrepared?.(spec.nodeId, report)
        authoring(error.message, path)
      }
    }
    if (supported.length !== 1) {
      if (spec.sourcePaths.length && !(structuralReport && spec.sourcePaths.length === 1)) {
        authoring("Нет однозначного исполняемого preview: исправьте оформление сценария", spec.sourcePaths[0]!)
      }
      continue
    }
    signal.throwIfAborted()
    const result = await read(supported[0]!)
    verify(result)
    onPrepared?.(spec.nodeId, result)
    const violations = result.validation.checks.filter(check => check.status === "failed" && check.rule !== "execution")
    if (violations.length) {
      continue
    }
    if (result.preview === undefined) {
      authoring(`Не удалось подготовить представление распознанного сценария ${supported[0]}: проверьте наблюдённый вызов и представимость его аргументов`, supported[0]!)
      continue
    }
    const preview = result.preview
    prepared.push(Object.freeze(preview.kind === "function" ? {
      nodeId: spec.nodeId, ...preview,
    } : {
      nodeId: spec.nodeId, kind: "component" as const,
      module: Object.freeze({
        path: stableBuildInputPath(preview.module.path),
        export: preview.module.export,
        ...(preview.module.source ? {source: preview.module.source} : {}),
      }),
      variants: preview.variants,
    }))
  }
  return Object.freeze(prepared)
}

/** Исполнение остаётся обязательным в обоих режимах стандарта. */
function assertScenarioExecution(report: ReadScenarioOutput): void {
  if (report.exitCode !== 0 || report.tests.some(test => test.status === "failed" || test.status === "error")) {
    throw storybookBuildError(storybookDiagnostic("validate", report.stderr || "Сценарий завершился с ошибкой", report.path))
  }
}
