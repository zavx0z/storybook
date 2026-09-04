import {CheckboxField} from "@zavx0z/ui/fields/checkbox-field"
import {NumberField} from "@zavx0z/ui/fields/number-field"
import {TextField} from "@zavx0z/ui/fields/text-field"

type ValueFieldDefinition = Readonly<{
  id: string
  label: string
  readOnly: true
}> & (
  | Readonly<{kind: "boolean"; value: boolean}>
  | Readonly<{kind: "number"; value: number}>
  | Readonly<{kind: "text"; value: string}>
  | Readonly<{kind: "readonly"; value: string}>
)

export function ValueFields(props: Readonly<{value: unknown}>) {
  const fields = fieldsFromValue(props.value)
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 4px;
  `}>
    {fields.map(definition => <ValueField
      key={definition.id}
      definition={definition}
    />)}
  </div>
}

function ValueField(props: Readonly<{definition: ValueFieldDefinition}>) {
  const definition = props.definition
  return <div style={css`
    display: contents;
  `}>
    {definition.kind === "boolean" ? <CheckboxField
      label={definition.label}
      checked={definition.value}
      readOnly={definition.readOnly}
    /> : null}
    {definition.kind === "number" ? <NumberField
      label={definition.label}
      value={definition.value}
      readOnly={definition.readOnly}
    /> : null}
    {definition.kind === "text" ? <TextField
      label={definition.label}
      value={definition.value}
      readOnly={definition.readOnly}
    /> : null}
    {definition.kind === "readonly" ? <ValueOutput definition={definition} /> : null}
  </div>
}

function ValueOutput(props: Readonly<{
  definition: Extract<ValueFieldDefinition, Readonly<{kind: "readonly"}>>
  }>) {
  return <div style={css`
    display: flex;
    flex-direction: row;
    min-height: 28px;
    gap: 4px;
  `}>
    <span style={css`
      display: block;
      width: 40%;
    `}>{props.definition.label}</span>
    <output style={css`
      display: block;
      min-width: 0;
      flex-grow: 1;
    `}>{props.definition.value}</output>
  </div>
}

function fieldsFromValue(value: unknown): readonly ValueFieldDefinition[] {
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

function fieldFromEntry(key: string, value: unknown): ValueFieldDefinition {
  const base = {id: `widget-${key}`, label: key, readOnly: true} as const
  if (typeof value === "boolean") {
    return Object.freeze({...base, kind: "boolean", value})
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze({...base, kind: "number", value})
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
