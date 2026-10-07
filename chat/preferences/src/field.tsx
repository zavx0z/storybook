import SelectField from "@zavx0z/immersive-ui-component-field-select"
import type {StorybookChatPreferences} from "../contract"

const sourceLabels: Readonly<Record<string, string>> = {
  general: "Общие настройки", type: "Настройки типа сущности", executor: "Настройки агента", session: "Эта беседа", native: "Настройки подключения",
}
const effortLabels: Readonly<Record<string, string>> = {
  none: "Без рассуждения", minimal: "Минимальное", low: "Низкое", medium: "Среднее",
  high: "Высокое", xhigh: "Очень высокое", max: "Максимальное", ultra: "Ультра",
}

/** Сохранённый override виден даже до загрузки возможностей или после их изменения. */
export function PreferenceField(props: StorybookChatPreferences.Input & Readonly<{
  field: "connectionId" | "model" | "thoughtLevel"
  onValue?(value: string): void
}>) {
  const category = props.field === "model" ? "model" : "thought_level"
  const setting = props.settings.find(item => item.category === category)
  const unsupported = props.field === "thoughtLevel" && props.settings.length > 0 && !setting
  const selected = props.selection[props.field]
  const actual = props.effective?.[props.field] ?? (props.field === "connectionId" ? undefined : setting?.value)
  const label = (value: string) => props.field === "connectionId"
    ? props.connections.find(item => item.id === value)?.label ?? value
    : props.field === "thoughtLevel" ? effortLabels[value] ?? setting?.options.find(item => item.value === value)?.name ?? value
    : setting?.options.find(item => item.value === value)?.name ?? value
  const options = setting?.options.map(item => ({key: item.value, value: item.value, label: label(item.value)})) ?? []
  if (selected && !options.some(item => item.value === selected)) options.push({key: selected, value: selected, label: `${label(selected)} · сохранено`})
  return <div style={css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `}>
    {props.field === "connectionId" ? null : <SelectField
      density="regular"
      label={props.field === "model" ? "Модель" : "Мышление"}
      value={selected ?? ""}
      options={[{key: "inherit", value: "", label: selected === undefined && actual !== undefined ? `${label(actual)} · ${props.inheritLabel ?? "Наследовать"}` : props.inheritLabel ?? "Наследовать"}, ...options]}
      disabled={props.busy || (!setting && !selected)}
      onChange={value => props.onValue?.(value)}
    />}
    {unsupported ? <PreferenceSource text={selected
      ? "Сохранённое мышление недоступно для этой модели. Вернитесь к наследованию."
      : "Модель не предоставляет выбор мышления."} /> : null}
    {actual === undefined || selected === undefined ? null : <PreferenceSource text={sourceLabels[props.sources?.[props.field] ?? "native"] ?? "Настройки подключения"} />}
  </div>
}
function PreferenceSource(props: Readonly<{text: string}>) {
  return <p style={css`
    margin: 0;
    align-self: flex-end;
    font-size: 12px;
    color: var(--widget-regular-content);
  `}>{props.text}</p>
}
