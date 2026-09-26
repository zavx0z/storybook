import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import {Typography} from "@zavx0z/ui/typography"
import type {ReadScenarioGuideOutput} from "@archetypes/specs/scenarios"
import {ScenarioGuideExample} from "./guide-example"

/** Принимает только явно помеченное руководство с переносимыми кодовыми примерами. */
export function isScenarioGuide(value: unknown): value is ReadScenarioGuideOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === "scenario-guide"
    && Array.isArray(candidate.files) && candidate.files.every(file => file && typeof file.path === "string" && ["scenario", "public-entry", "contract", "fixture"].includes(file.role))
    && Array.isArray(candidate.examples) && candidate.examples.every(example => example && typeof example.title === "string" && typeof example.code === "string")
    && Array.isArray(candidate.checks) && candidate.checks.every(check => check && typeof check.rule === "string" && ["passed", "failed", "not-checked"].includes(check.status) && Array.isArray(check.issues) && check.issues.every((issue: unknown) => typeof issue === "string"))
}

/** Показывает учебное содержание как структуру файлов и код, сохраняя проверенные фрагменты. */
export function ScenarioGuideResult(props: Readonly<{guide: ReadScenarioGuideOutput}>) {
  const fileRoles = {scenario: "сценарий", "public-entry": "публичный вход", contract: "контракт", fixture: "фикстура"}
  const checkStates = {passed: "проверено", failed: "нарушено", "not-checked": "не проверено"}
  const filesHeight = Math.min(180, Math.max(56, props.guide.files.length * 16 + 20))
  return <section
    data-scenario-guide=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      gap: 12px;
    `}
  >
    <Typography text="Структура файлов" />
    <CodeEditor
      languageId="plaintext"
      readOnly={true}
      value={props.guide.files.map(file => `${file.path} — ${fileRoles[file.role]}`).join("\n")}
      style={css`
        width: 100%;
        height: ${filesHeight}px;
        min-height: 56px;
        flex-shrink: 0;
      `}
    />
    {props.guide.examples.map((example, index) => (
      <ScenarioGuideExample
        key={String(index)}
        title={example.title}
        code={example.code}
      />
    ))}
    <Typography text="Проверка правил" />
    {props.guide.checks.map(check => (
      <Typography
        key={check.rule}
        text={`${check.rule}: ${checkStates[check.status]}${check.issues.length ? ` — ${check.issues.join("; ")}` : ""}`}
      />
    ))}
  </section>
}
