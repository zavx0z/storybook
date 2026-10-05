/**
Проверяет сохраняемую историю беседы и предоставляет общую предметную timeline
серверу и представлению. Содержимое и события ACP проверяются опубликованной
схемой протокола через готовые Ajv standalone validators без runtime compilation;
reader сохраняет исходные metadata и не восстанавливает
недоступный ему внутренний контекст модели.

@packageDocumentation
*/
import {timelineSchema} from "./src/schema"
import type {StorybookChatHistory} from "./contract"

export type {StorybookChatHistory} from "./contract"

/**
Читает сериализованную timeline без исполнения инструментов и обращения к файлам.

@param input - История, полученная из storage или транспорта.
@returns Независимая копия проверенных записей в исходном порядке.
@throws TypeError при повреждённой записи, дублированном id или нарушенном порядке.
*/
export default function readHistory(input: StorybookChatHistory.Input): StorybookChatHistory.Output {
  const result = timelineSchema.safeParse(input)
  if (!result.success) throw new TypeError(`Повреждена timeline беседы: ${result.error.message}`)
  return structuredClone(result.data) as StorybookChatHistory.Output
}
