/**
Канонический plan явно заданных входов и границ сборки.

@property identity - JSON-like соглашение владельца, хешируемое в `descriptorDigest`.

@property scope - Канонические owner roots, exact files и output exclusions.

@property compilerAdapterPath - Exact compiler plugin entry, входящий в toolchain digest.

@property toolchainFiles - Exact runtime/compiler files установленного toolchain.

@property validationAbi - Build options и protocol constants конкретного владельца.
*/
export type BuildInputPlan = Readonly<{
  identity: unknown
  scope: BuildInputScope
  compilerAdapterPath: string
  toolchainFiles: readonly string[]
  validationAbi: Readonly<Record<string, unknown>>
}>

/**
Данные владельца для канонизации через `BuildInputs.plan`.

Владелец выбирает свои roots, compiler inputs и ABI до вызова Inputs.
Все roots и exact файлы существуют; последний сегмент exact файла не symlink.

@property identity - Декларативные входы владельца без output state.

@property roots - Owner roots полного снимка путей.

@property compilerRoots - TypeScript semantic roots, чьи source bytes влияют на compiler.

@property [guardRoots] - Допустимые корни resolver closure, без полного обхода их содержимого.

@property files - Exact entry/config/resource/closure files.

@property compilerAdapterPath - Публичный adapter фактически выбранного compiler plugin.

@property toolchainFiles - Exact installed toolchain entries вне owner inventory.

@property validationAbi - Build/protocol options, которые меняют смысл успешной проверки.

@property [excludedRoots] - Output/candidate roots текущей операции.

@property [resolutionDirectories] - Persisted external resolution directories.
*/
export type BuildInputPlanInput = Readonly<{
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
Канонические границы чтения входов и проверки дополнительной compiler closure.

@property roots - Минимизированные canonical owner roots для снимка исходников.

@property guardRoots - Inventory roots плюс известные npm resolution roots для проверки допустимых зависимостей.

@property files - Exact inputs вне либо внутри roots, которые нельзя потерять из fingerprint.

@property compilerRoots - Узкие implementation roots compiler plugins, хешируемые целиком.

@property resolutionDirectories - External каталоги, исключённые из полного owner inventory.

@property excludedRoots - Candidate artifacts текущей операции, создаваемые самой сборкой.
*/
export type BuildInputScope = Readonly<{
  roots: readonly string[]
  guardRoots: readonly string[]
  files: readonly string[]
  compilerRoots: readonly string[]
  resolutionDirectories: readonly string[]
  excludedRoots: readonly string[]
}>
