/** Загружает проверяемую модель и fixture того же Workbench после общего compiler preload. */
let loading: Promise<typeof import("./create-workbench")> | null = null

export function loadCompiledWorkbench(): Promise<typeof import("./create-workbench")> {
  loading ??= import("./create-workbench")
  return loading
}
