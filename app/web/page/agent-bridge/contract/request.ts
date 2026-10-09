/** Точная semantic цель: стабильный nodeId либо сочетание role и name. */
export type Target = Readonly<{
  nodeId?: string
  role?: string
  name?: string
}>

export type Request = Readonly<{
  schemaVersion?: 1
  protocol: "external-storybook-agent-bridge/1"
  expectedPackageId?: string | null
  operation: "state" | "inspect" | "interact" | "capture" | "applyRevision" | "navigate"
  packageId?: string | null
  route?: string
  url?: string
  followEnvironment?: true
  revision?: string
  include?: readonly string[]
  maxDepth?: number
  limit?: number
  cursor?: string
  target?: Target
  destination?: Target
  /** fill заменяет весь текст writable textarea/text-like input; пустая строка очищает поле. */
  action?: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "fill" | "wheel" | "scenario"
  value?: unknown
  timeoutMs?: number
}>
