import type BuildInputs from "@build/inputs"
import type {BuildEnvironment} from "@build/environment"
import type {PackageSession} from "@package/session"

/**
Вход пакетного адаптера связывает дескриптор с фактическими путями исполнения и компиляции.

@property toolRoot - Корень исполняемой сборочной системы, выбранный композицией сервера.
@property descriptor - Граф, ресурсы, пути модулей и публичные имена конкретной ревизии пакета.
@property browserEntryPath - Входной модуль основного браузерного результата.
@property [stagingDirectory] - Каталог результата кандидата, исключённый из входов.
@property [additionalFilePaths] - Фактические зависимости, обнаруженные компилятором.
@property [resolutionDirectories] - Сохранённые внешние каталоги разрешения модулей для повторной проверки.
*/
export type StorybookPackageBuildInputFingerprintRequest = Readonly<{
  toolRoot: string
  descriptor: PackageSession.Input[0]
  browserEntryPath: string
  sharedBrowserIdentity?: ReturnType<BuildEnvironment.Output["identity"]>
  stagingDirectory?: string
  additionalFilePaths?: readonly string[]
  resolutionDirectories?: readonly string[]
}>

/** Проверенный состав входов, применяемый BuildInputs без повторного поиска владельцев. */
export type StorybookPackageBuildInputFingerprintPlan = ReturnType<typeof BuildInputs.plan>
