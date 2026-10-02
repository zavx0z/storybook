/** Точная semantic цель: стабильный nodeId либо сочетание role и name. */
export type Target = Readonly<{
  nodeId?: string
  role?: string
  name?: string
}>

export type Request = Readonly<{
  protocol: "external-storybook-agent-bridge/1"
  expectedPackageId?: string
  operation: "state" | "inspect" | "interact" | "capture" | "applyRevision"
  revision?: string
  include?: readonly string[]
  maxDepth?: number
  limit?: number
  cursor?: string
  target?: Target
  destination?: Target
  action?: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: unknown
  timeoutMs?: number
}>
