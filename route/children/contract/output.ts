import type {ResolveRouteOutput} from "../.."

/**
Разрешённые непосредственные дочерние маршруты в порядке объявлений владельца.
*/
export type ReadRouteChildrenOutput = readonly NonNullable<ResolveRouteOutput>[]
