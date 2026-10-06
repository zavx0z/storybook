/**
Раскрывает выбранного владельца из единственного каталога Storybook.
Структура задаёт переходы; контракты раскрываются как JSON Schema, сценарии сохраняют авторский код.
Корневой ответ формирует предметный владелец Project через собственную проекцию.
Пакет с подтверждённым типом обслуживает проекция соответствующего владельца.
Без подтверждения сохраняются общие сведения и явное состояние type-unconfirmed.
Хост закрепляет root подключения. Пустой вызов возвращает к нему, а адреса
children на любой глубине отсчитываются от той же точки входа.

@packageDocumentation
*/
import resolveKnowledgeAddress from "@zavx0z/storybook-app-knowledge-address"
import readProjectMcp from "@zavx0z/storybook-app-knowledge-project"
import navigation from "@zavx0z/storybook-app-knowledge-navigation"
import content from "@zavx0z/storybook-app-knowledge-content"
import readPackageMcp from "@zavx0z/storybook-package-env"
import type {StorybookAppKnowledge} from "./contract"
import {rootEntries} from "./src/root"
import readRepoMcp from "@zavx0z/storybook-repo-env"
import readComponentMcp from "@zavx0z/storybook-component-env"
import readContainerMcp from "@zavx0z/storybook-container-env"
import readClusterMcp from "@zavx0z/storybook-cluster-env"
import readDomainMcp from "@zavx0z/storybook-domain-env"

const entityEnv = {
  Repo: readRepoMcp,
  Component: readComponentMcp,
  Container: readContainerMcp,
  Cluster: readClusterMcp,
  Domain: readDomainMcp,
}

export type {StorybookAppKnowledge} from "./contract"

/**
Навигационная проекция canonical graph без повторного discovery.

@property entries - Публичные адреса, назначение, родитель и проверенные источники каждого владельца.
*/

/**
Отдаёт корневые направления либо содержание выбранного владельца и его детей.

@param request - GET без query либо POST с единственным необязательным path.
@param options - Публичная структура, источники и необязательный фиксированный root подключения.
@returns Назначение, схемы контрактов, сценарии и непосредственные переходы. Чтение не выполняет код и не запускает сборку.
*/
export default async function storybookRest(request: StorybookAppKnowledge.Input[0], options: StorybookAppKnowledge.Input[1]): Promise<StorybookAppKnowledge.Output> {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({status: "failed", error: "Поддерживаются GET и POST"}, {status: 405, headers: {Allow: "GET, POST"}})
  }
  if (new URL(request.url).search !== "") {
    return Response.json({status: "failed", error: "Адрес знаний не содержит параметров"}, {status: 400})
  }
  let input: unknown = {}
  if (request.method === "POST") {
    const body = await request.text()
    if (body.length > 16_384) return Response.json({status: "failed", error: "Слишком большой запрос"}, {status: 413})
    try {
      input = body === "" ? {} : JSON.parse(body)
    } catch {
      return Response.json({status: "failed", error: "Ожидается JSON-объект"}, {status: 400})
    }
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "path")
    || ("path" in input && typeof input.path !== "string")) {
    return Response.json({status: "failed", error: "Ожидается только необязательный path — адрес из children"}, {status: 400})
  }
  const path = "path" in input && input.path !== "." ? input.path as string : undefined
  try {
    const entries = rootEntries(options)
    if (path === undefined && options.root === undefined) return Response.json(readProjectMcp({...options, entries}))
    let address = ""
    if (path !== undefined) {
      try { address = resolveKnowledgeAddress({address: path, paths: entries.map(item => item.path)}) }
      catch (error) {
        if (options.root !== undefined && !(error instanceof TypeError)) return Response.json({status: "failed", error: "Адрес вне назначенной области знаний"}, {status: 403})
        throw error
      }
    }
    const selected = entries.find(item => item.path === address)!
    if (selected.readType !== undefined) {
      const verification = await selected.readType()
      if (verification.status === "confirmed") {
        const sources = selected.sources
        const declaration = entityEnv[verification.type]({...(selected.directory === undefined ? {} : {directory: selected.directory}), sources})
        return Response.json({...navigation({path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}), description: selected.description, entries}),
          ...await content(sources, declaration.documents, selected.directory), verification})
      }
      return Response.json({
        ...navigation({path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}), description: selected.description, entries}),
        status: "type-unconfirmed",
        message: "Тип сущности ещё не подтверждён нормативным сценарием Package.",
        verification,
      })
    }
    const sources = selected.sources
    return Response.json({...navigation({path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}), description: selected.description, entries}),
      ...await content(sources, readPackageMcp({...(selected.directory === undefined ? {} : {directory: selected.directory}), sources}).documents, selected.directory)})
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)},
      {status: error instanceof TypeError ? 400 : 404})
  }
}
