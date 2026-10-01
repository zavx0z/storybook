import type {BuildInputFile} from "./fingerprint"

/** Чтение и подтверждение явно заданных входов одного прохода сборки. */
export declare namespace BuildInputs {
  /**
  Данные владельца для канонизации плана входов.
  Корни и exact файлы существуют; последний сегмент exact файла не symlink.

  @property identity - Декларативная identity владельца без output state.
  @property roots - Корни полного снимка исходников.
  @property [guardRoots] - Допустимые корни resolver closure.
  @property compilerRoots - Узкие корни implementation компилятора.
  @property files - Точные entry, config и resource files.
  @property compilerAdapterPath - Выбранный plugin entry компилятора.
  @property toolchainFiles - Точные файлы установленного toolchain.
  @property validationAbi - Options и protocol constants, влияющие на проверку.
  @property [excludedRoots] - Каталоги результатов текущей операции.
  @property [resolutionDirectories] - Сохранённые каталоги разрешения модулей.
  */
  type Input = Readonly<{
    identity: unknown
    roots: readonly string[]
    guardRoots?: readonly string[]
    compilerRoots: readonly string[]
    files: readonly string[]
    compilerAdapterPath: string
    toolchainFiles: readonly string[]
    validationAbi: Readonly<Record<string, unknown>>
    excludedRoots?: readonly string[]
    resolutionDirectories?: readonly string[]
  }>

  /**
  Сравнимое байтовое свидетельство прочитанных входов и границ их проверки.
  Digests отражают содержимое; inode и timestamps служат attestation, но не restart key.

  @property protocol - Версия состава и сериализации fingerprint.
  @property digest - Итоговый cache key; неизвестная версия всегда miss.
  @property descriptorDigest - Identity владельца в канонической сериализации.
  @property sourceDigest - Корни, inventory и байты исходников и ресурсов.
  @property toolchainDigest - Bun и явно заданные compiler inputs.
  @property validationDigest - Options и ABI проверки результата.
  @property roots - Корни owner graph.
  @property resolutionDirectories - Внешние каталоги, где новый файл меняет resolution.
  @property directories - Посещённые каталоги inventory и closure.
  @property files - Exact closure и control files с байтовым evidence.
  */
  type Output = Readonly<{
    protocol: "storybook-build-input/2"
    digest: string
    descriptorDigest: string
    sourceDigest: string
    toolchainDigest: string
    validationDigest: string
    roots: readonly string[]
    resolutionDirectories: readonly string[]
    directories: readonly string[]
    files: readonly BuildInputFile[]
  }>
}
