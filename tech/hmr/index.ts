/**
Предоставляет последовательную замену исполнения с откатом и восстановление
соединения обновлений. Маршруты, содержимое сообщений и подтверждение пакетных
ревизий принадлежат вызывающим владельцам. Эти механизмы не запускают сборку.

@packageDocumentation
*/
export {default as createHmrPage} from "@hmr/page"
export type {HmrPage} from "@hmr/page"
export {default as createHmrConnection} from "@hmr/connection"
export type {HmrConnection} from "@hmr/connection"
