import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import ToolTerminal from "../src/terminal-output-view"

test("обычные детали показывают terminal data и exit читаемо без metadata JSON", async () => {
  const headless = createHeadless({width: 480, height: 500})
  try {
    const element = await headless.render(<ToolTerminal
      id="tool"
      call={{_meta: {terminal_output_delta: {terminal_id: "t", stream: "stderr", data: "Permission denied\n"}, terminal_exit: {terminal_id: "t", exit_code: 1, signal: null}}}}
    />)
    await headless.capture(element)
    expect(element.querySelector('[data-chat-terminal-stream="stderr"]')).not.toBeNull()
    expect(element.textContent).toContain("Permission denied")
    expect(element.textContent).toContain("Код завершения: 1")
    expect(element.textContent).not.toContain("terminal_output_delta")
    expect(element.textContent).not.toContain("exit_code")
  } finally {await headless.dispose()}
})
