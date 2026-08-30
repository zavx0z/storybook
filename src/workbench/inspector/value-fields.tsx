import {Field, type FieldDefinition} from "@ui/components/field"

export function ValueFields(props: Readonly<{value: unknown}>) {
  const fields = fieldsFromValue(props.value)
  return <div style={css`
    & {
      display: flex;
      flex-direction: column;
      width: 100%;
      gap: 4px;
    }
  `}>
    {fields.map(definition => <Field key={definition.id} definition={definition} />)}
  </div>
}

function fieldsFromValue(value: unknown): readonly FieldDefinition[] {
  const entries = value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [["value", value]] as const
  if (entries.length === 0) {
    return Object.freeze([Object.freeze({
      id: "widget-empty",
      label: "Value",
      kind: "readonly",
      value: "—",
      readOnly: true,
    })])
  }
  return Object.freeze(entries.map(([key, entry]) => fieldFromEntry(key, entry)))
}

function fieldFromEntry(key: string, value: unknown): FieldDefinition {
  const base = {id: `widget-${key}`, label: key, readOnly: true} as const
  if (typeof value === "boolean") {
    return Object.freeze({...base, kind: "boolean", value, presentation: "checkbox"})
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze({...base, kind: Number.isInteger(value) ? "integer" : "number", value})
  }
  if (typeof value === "string") return Object.freeze({...base, kind: "text", value})
  return Object.freeze({...base, kind: "readonly", value: printable(value)})
}

function printable(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}`
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
