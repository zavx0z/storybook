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
