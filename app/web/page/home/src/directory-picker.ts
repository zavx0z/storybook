type PickerWindow = Readonly<{
  showDirectoryPicker?(options: Readonly<{id: string; mode: "read" | "readwrite"}>): Promise<FileSystemDirectoryHandle>
}>

/** Вызывается непосредственно из пользовательского события, до сетевых запросов. */
export function pickStorybookDirectory(window: PickerWindow = globalThis as PickerWindow, mode: "read" | "readwrite" = "readwrite"): Promise<FileSystemDirectoryHandle> {
  if (typeof window.showDirectoryPicker !== "function") {
    return Promise.reject(new Error("Этот браузер не поддерживает системный выбор папки."))
  }
  return window.showDirectoryPicker({id: "storybook-project", mode})
}

/** Одноразовая метка связывает выбранный handle с каталогом локального сервера. */
export async function attachPickedDirectory(
  directory: FileSystemDirectoryHandle,
  request: (action: "directory" | "attach", body: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<void> {
  const challenge = await request("directory", {})
  const {token, filename, content} = challenge
  if (typeof token !== "string" || typeof filename !== "string" || typeof content !== "string" ||
    filename !== `.storybook-selection-${token}` || !/^[a-f0-9-]{36}$/u.test(token)) {
    throw new Error("Некорректное подтверждение выбранной папки")
  }
  let created = false
  try {
    const file = await directory.getFileHandle(filename, {create: true})
    created = true
    const stream = await file.createWritable()
    try {
      await stream.write(content)
      await stream.close()
    } catch (error) {
      await stream.abort().catch(() => {})
      throw error
    }
    await request("attach", {selectionToken: token})
  } finally {
    if (created) await directory.removeEntry(filename)
  }
}
