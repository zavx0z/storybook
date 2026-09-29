/**
Замена исполняемой части страницы с восстановлением предыдущей при ошибке.
Отображение, Canvas и адрес принадлежат приложению, подключающему этот lifecycle.
@packageDocumentation
*/
export {default as createHmrPage} from "@hmr/page"
export type {HmrPageInput, HmrPageOutput} from "@hmr/page"
export {default as createHmrConnection} from "@hmr/connection"
export type {HmrConnectionInput, HmrConnectionOutput, HmrSocket} from "@hmr/connection"
