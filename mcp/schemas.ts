import {z} from "zod"
import {STORYBOOK_MCP_SCHEMA_VERSION} from "../src/external/browser-control/types.ts"

const schemaVersion = z.literal(STORYBOOK_MCP_SCHEMA_VERSION)
const boundedPath = z.string().min(1).max(4_096).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value),
  "path contains control characters")
const boundedId = z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/u)
const packageId = z.string().max(256).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u)
const route = z.string().max(2_048).refine((value) => value === "" || (
  !value.startsWith("/") && !value.endsWith("/") && !value.includes("//") &&
  !value.includes("\\") && !/[?#\u0000-\u001f\u007f]/u.test(value) &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
), "route must be normalized and package-local")
const viewId = z.string().regex(/^storybook-view-v1_[A-Za-z0-9_-]{43}$/u)
const revision = z.string().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/u)
const cursor = z.string().min(1).max(2_048).regex(/^(?:offset:[0-9]+|[A-Za-z0-9._~-]+)$/u)
const timeoutMs = z.number().int().min(100).max(120_000)
const interactionTimeoutMs = z.number().int().min(100).max(30_000)
const limit = z.number().int().min(1).max(200)

const uniqueList = <Schema extends z.ZodType>(schema: Schema, maximum: number) => z.array(schema).max(maximum)
  .refine((values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length, "list must be unique")

export const storybookEnsureSchema = z.strictObject({
  schemaVersion,
  roots: uniqueList(boundedPath, 32).optional(),
})

export const storybookStatusSchema = z.strictObject({
  schemaVersion,
  scope: boundedId.optional(),
  includeViews: z.boolean().optional(),
})

export const storybookAttachSchema = z.strictObject({
  schemaVersion,
  root: boundedPath,
})

export const storybookDetachSchema = z.strictObject({
  schemaVersion,
  scopeId: boundedId,
})

export const storybookSearchSchema = z.strictObject({
  schemaVersion,
  query: z.string().min(1).max(512),
  packageId: packageId.optional(),
  kinds: uniqueList(z.enum(["workspace", "project", "package", "category", "subject", "variant"]), 6).optional(),
  limit: limit.optional(),
  cursor: cursor.optional(),
})

export const storybookOpenSchema = z.strictObject({
  schemaVersion,
  packageId,
  route: route.optional(),
})

export const storybookWaitSchema = z.strictObject({
  schemaVersion,
  packageId: packageId.optional(),
  viewId: viewId.optional(),
  afterRevision: revision.optional(),
  condition: z.enum(["built", "active", "ready", "presented", "failed"]),
  timeoutMs: timeoutMs.optional(),
}).refine((value) => value.packageId !== undefined || value.viewId !== undefined,
  "packageId or viewId is required")
  .refine((value) => !["built", "active", "failed"].includes(value.condition) || value.packageId !== undefined,
    "built, active and failed waits require packageId")
  .refine((value) => !["built", "active", "failed"].includes(value.condition) || value.viewId === undefined,
    "built, active and failed waits accept packageId only")

export const storybookInspectSchema = z.strictObject({
  schemaVersion,
  viewId,
  include: uniqueList(z.enum(["state", "diagnostics", "console", "semantic", "layout", "display", "canvases"]), 7).optional(),
  maxDepth: z.number().int().min(0).max(12).optional(),
  limit: limit.optional(),
  cursor: cursor.optional(),
})

const interactionTarget = z.strictObject({
  nodeId: boundedId.optional(),
  role: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(512).optional(),
}).refine((value) => value.nodeId !== undefined || (value.role !== undefined && value.name !== undefined),
  "target requires nodeId or exact role and name")

const finiteDelta = z.number().finite().min(-10_000).max(10_000)
const interactionValue = z.union([
  z.string().max(4_096),
  finiteDelta,
  z.strictObject({
    key: z.string().min(1).max(64),
    modifiers: uniqueList(z.enum(["alt", "ctrl", "meta", "shift"]), 4).optional(),
  }),
  z.strictObject({text: z.string().max(4_096)}),
  z.strictObject({
    deltaY: finiteDelta,
    deltaX: finiteDelta.optional(),
    deltaZ: finiteDelta.optional(),
  }),
  z.strictObject({dx: finiteDelta, dy: finiteDelta}),
])

export const storybookInteractSchema = z.strictObject({
  schemaVersion,
  viewId,
  target: interactionTarget.optional(),
  action: z.enum(["hover", "focus", "click", "pointerDown", "pointerUp", "drag", "key", "type", "wheel", "scenario"]),
  value: interactionValue.optional(),
  destination: z.strictObject({nodeId: boundedId}).optional(),
  timeoutMs: interactionTimeoutMs.optional(),
}).superRefine((value, context) => {
  const nodeAction = ["hover", "focus", "click", "pointerDown", "pointerUp", "drag", "key", "type", "wheel"]
    .includes(value.action)
  if (nodeAction && value.target === undefined) {
    context.addIssue({code: "custom", path: ["target"], message: `${value.action} requires target`})
  }
  const relativeDrag = isObjectWith(value.value, "dx") && isObjectWith(value.value, "dy")
  if (value.action === "drag" && value.destination === undefined && !relativeDrag) {
    context.addIssue({code: "custom", path: ["destination"], message: "drag requires destination nodeId or dx/dy"})
  }
  if (value.action !== "drag" && value.destination !== undefined) {
    context.addIssue({code: "custom", path: ["destination"], message: "destination is accepted only for drag"})
  }
  if (["hover", "focus", "click", "pointerDown", "pointerUp"].includes(value.action) &&
    value.value !== undefined) {
    context.addIssue({code: "custom", path: ["value"], message: `${value.action} does not accept value`})
  }
  if (value.action === "drag" && value.destination !== undefined && value.value !== undefined) {
    context.addIssue({code: "custom", path: ["value"], message: "drag accepts destination or dx/dy, not both"})
  }
  if (value.action === "scenario" && typeof value.value !== "string") {
    context.addIssue({code: "custom", path: ["value"], message: "scenario requires string value"})
  }
  if (value.action === "key" && !(typeof value.value === "string" || isObjectWith(value.value, "key"))) {
    context.addIssue({code: "custom", path: ["value"], message: "key requires string or key object"})
  }
  if (value.action === "type" && !(typeof value.value === "string" || isObjectWith(value.value, "text"))) {
    context.addIssue({code: "custom", path: ["value"], message: "type requires string or text object"})
  }
  if (value.action === "wheel" && !(typeof value.value === "number" || isObjectWith(value.value, "deltaY"))) {
    context.addIssue({code: "custom", path: ["value"], message: "wheel requires number or deltaY object"})
  }
})

export const storybookCaptureSchema = z.strictObject({
  schemaVersion,
  viewId: viewId.optional(),
  packageId: packageId.optional(),
  route: route.optional(),
  area: z.enum(["page", "workbench", "preview", "canvas", "node"]),
  nodeId: boundedId.optional(),
  failOnConsoleError: z.boolean().optional(),
  timeoutMs: timeoutMs.optional(),
}).superRefine((value, context) => {
  if (value.viewId === undefined && value.packageId === undefined) {
    context.addIssue({code: "custom", message: "viewId or packageId is required"})
  }
  if (value.area === "node" && value.nodeId === undefined) {
    context.addIssue({code: "custom", message: "node area requires nodeId"})
  }
  if (value.area !== "node" && value.nodeId !== undefined) {
    context.addIssue({code: "custom", message: "nodeId is accepted only for node area"})
  }
})

export const storybookCheckSchema = z.strictObject({
  schemaVersion,
  scope: boundedPath,
  live: z.boolean().optional(),
  timeoutMs: timeoutMs.optional(),
})

export const storybookCloseSchema = z.strictObject({
  schemaVersion,
  viewId,
})

export const storybookStopSchema = z.strictObject({
  schemaVersion,
  confirm: z.literal(true),
})

export const STORYBOOK_TOOL_SCHEMAS = Object.freeze({
  storybook_ensure: storybookEnsureSchema,
  storybook_status: storybookStatusSchema,
  storybook_attach: storybookAttachSchema,
  storybook_detach: storybookDetachSchema,
  storybook_search: storybookSearchSchema,
  storybook_open: storybookOpenSchema,
  storybook_wait: storybookWaitSchema,
  storybook_inspect: storybookInspectSchema,
  storybook_interact: storybookInteractSchema,
  storybook_capture: storybookCaptureSchema,
  storybook_check: storybookCheckSchema,
  storybook_close: storybookCloseSchema,
  storybook_stop: storybookStopSchema,
})

export type StorybookToolName = keyof typeof STORYBOOK_TOOL_SCHEMAS

export const STORYBOOK_TOOL_NAMES = Object.freeze(Object.keys(STORYBOOK_TOOL_SCHEMAS) as StorybookToolName[])

function isObjectWith(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && key in value
}
