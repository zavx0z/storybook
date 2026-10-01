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
