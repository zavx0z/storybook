/**
Байтовое evidence exact regular файла с identity, снятой во время чтения.

@property path - Канонический lexical path, входящий в owner/resolver boundary.

@property contentDigest - SHA-256 байтов, используемый для restart comparison.

@property size - Число прочитанных байтов.

@property device - Устройство открытого exact non-symlink файла во время attestation.

@property inode - Inode открытого файла во время attestation.

@property modifiedNs - Время изменения из того же `fstat`, что и прочитанные байты.
*/
export type BuildInputFile = Readonly<{
  path: string
  contentDigest: string
  size: number
  device: string
  inode: string
  modifiedNs: string
}>

/**
Версионированный снимок входов, пригодный для сохранения и сравнения cache key.

Digests выражают identity, пути и содержимое. Kernel markers файлов сохраняются
для attestation; restart comparison не зависит от inode и времени изменения.

@property protocol - Версия состава и canonical serialization fingerprint.

@property digest - Итоговый cache key всех категорий; неизвестная версия всегда miss.

@property descriptorDigest - Canonical JSON-like identity, заданная владельцем plan.

@property sourceDigest - Canonical owner roots, inventory и байты source/config/resource files.

@property toolchainDigest - Bun executable/version и явно заданные toolchain/compiler inputs.

@property validationDigest - Build options и ABI validation/runtime protocol.

@property roots - Корни owner graph; служат доказательством консервативного inventory scope.

@property resolutionDirectories - Каталоги external closure, где новый соседний файл меняет resolution.

@property directories - Уже посещённые каталоги source inventory и resolution closure.

@property files - Exact closure и control files с полным byte evidence.
*/
export type BuildInputFingerprint = Readonly<{
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
