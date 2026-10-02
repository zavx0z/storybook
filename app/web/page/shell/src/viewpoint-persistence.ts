import type {ViewPointElement} from "@zavx0z/dom/viewpoint"
import type {CameraState, SavedState} from "../contract/viewpoint-state"

const cameraFields = ["x", "y", "z", "targetX", "targetY", "targetZ", "fov", "near", "far"] as const

/** Настройки HUD и обзор Workbench сохраняются для origin, независимо от сессии браузера. */
export function createViewPointPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.viewpoint.v1"
  const state: SavedState = {position: {edge: "top", offset: .5}}
  try {
    const saved = JSON.parse(storage().getItem(key) ?? "null")
    if (saved && typeof saved === "object") {
      if (typeof saved.frozen === "boolean") state.frozen = saved.frozen
      const position = saved.position
      if (position && ["left", "right", "top", "bottom"].includes(position.edge) &&
        typeof position.offset === "number" && Number.isFinite(position.offset)) {
        state.position = {edge: position.edge, offset: Math.max(0, Math.min(1, position.offset))}
      }
      const camera = saved.camera
      if (camera && cameraFields.every(field => typeof camera[field] === "number" && Number.isFinite(camera[field])) &&
        camera.near > 0 && camera.far > camera.near && camera.fov > 0 && camera.fov < Math.PI &&
        Math.hypot(camera.x - camera.targetX, camera.y - camera.targetY, camera.z - camera.targetZ) > 0) {
        state.camera = Object.fromEntries(cameraFields.map(field => [field, camera[field]])) as CameraState
      }
    }
  } catch {}
  const save = () => {
    try { storage().setItem(key, JSON.stringify(state)) } catch {}
  }
  return {
    state,
    savePosition(position: SavedState["position"]) {
      state.position = {...position}
      save()
    },
    saveFrozen(frozen: boolean) {
      state.frozen = frozen
      save()
    },
    saveCamera(camera: ViewPointElement) {
      state.camera = Object.fromEntries(cameraFields.map(field => [field, camera[field]])) as CameraState
      save()
    },
    restoreCamera(camera: ViewPointElement) {
      if (!state.camera) return
      const saved = state.camera
      camera.ownerDocument!.transaction(() => {
        for (const field of cameraFields) camera[field] = saved[field]
      })
    },
  }
}
