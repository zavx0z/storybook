/**
Archetypes описывает и проверяет единое устройство пакетов.
Project объединяет выбранные независимые Repo. Repo сам является пакетом-монорепозиторием.
Domain организует предметную область и её публичные пути; Component предоставляет
конкретное поведение. Domain и Component взаимоисключающие. Составность не создаёт
дополнительного класса: поддомен остаётся Domain, составной компонент — Component.

Единый сценарий Package выражает общие требования и применимые правила Repo,
Domain и Component. Его разделы и утверждения одновременно документируют устройство,
показывают пример и проверяют соответствие. Project проверяет композицию Repo.
Имена директорий, иконки и авторские поля манифеста не подтверждают классификацию.
Полнота проверки структуры не заменяет смысловую оценку предметных правил.

@packageDocumentation
*/
export {default as readSpecGuide} from "@archetypes/specs"
export {default as readComponent} from "@archetypes/component"
export {default as readProject} from "@archetypes/project"
export {default as readDomain} from "@archetypes/domain"
export {default as readRepo} from "@archetypes/repo"
export {default as readPackage} from "@archetypes/package"
export {default as readModuleDocumentation} from "@archetypes/package-documentation"
export {default as readPackageJson} from "@archetypes/package-json"
export {default as readPackageIndex} from "@archetypes/package-index"
export {default as createScenarioGuide} from "@archetypes/scenario-document"
export {default as readScenarioGuide} from "@archetypes/scenario-guide"
export {default as validateScenario} from "@archetypes/scenario-validation"

export type {ReadSpecGuideInput, ReadSpecGuideOutput} from "@archetypes/specs"

export type {ReadComponentInput, ReadComponentOutput} from "@archetypes/component"

export type {ReadProjectInput, ReadProjectOutput} from "@archetypes/project"

export type {ReadDomainInput, ReadDomainOutput} from "@archetypes/domain"

export type {ReadRepoInput, ReadRepoOutput} from "@archetypes/repo"

export type {ReadPackageInput, ReadPackageOutput} from "@archetypes/package"

export type {ReadModuleDocumentationInput, ReadModuleDocumentationOutput} from "@archetypes/package-documentation"

export type {ReadPackageJsonInput, ReadPackageJsonOutput} from "@archetypes/package-json"

export type {ReadPackageIndexInput, ReadPackageIndexOutput} from "@archetypes/package-index"

export type {CreateScenarioGuideInput, CreateScenarioGuideOutput} from "@archetypes/scenario-document"

export type {ReadScenarioGuideInput, ReadScenarioGuideOutput} from "@archetypes/scenario-guide"

export type {ValidateScenarioInput, ValidateScenarioOutput} from "@archetypes/scenario-validation"
