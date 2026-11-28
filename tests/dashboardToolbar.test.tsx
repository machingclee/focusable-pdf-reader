/**
 * The Dashboard's chrome row, in both kinds of build.
 *
 * A packaged build hides the backend's tools (the flow diagram and the event
 * log), so there are two things to hold at once: the buttons are gone, and the
 * row they sat in is not. The row is the window's second drag surface, its
 * height is what keeps the PDF view and the Dashboard level when the tab
 * changes, and it is where the next app-level control goes — none of which
 * depends on the buttons being drawn.
 *
 * The height itself is CSS (`toolbar-slot`), so what can be checked here is what
 * the markup promises: a `.toolbar` row with a drag region in both builds, the
 * tools in a development one, and the strut in a packaged one, standing in for
 * the pill the hidden buttons would have made.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardToolbar } from "../src/components/dashboard/DashboardToolbar";

function renderRow(
  showBackendTools: boolean,
  { eventLogOpen = false, error = null }: { eventLogOpen?: boolean; error?: string | null } = {},
): string {
  return renderToStaticMarkup(
    <DashboardToolbar
      showBackendTools={showBackendTools}
      eventLogOpen={eventLogOpen}
      onToggleEventLog={() => {}}
      error={error}
    />,
  );
}

describe("DashboardToolbar", () => {
  test("a development build shows the backend's tools", () => {
    const html = renderRow(true);
    expect(html).toContain(">Flow<");
    expect(html).toContain(">Events<");
    // Nothing to stand in for: the buttons are the row's height.
    expect(html).not.toContain("toolbar-slot");
  });

  test("the event log's button reads as pressed while the column is up", () => {
    expect(renderRow(true, { eventLogOpen: true })).toContain('aria-pressed="true"');
    expect(renderRow(true)).toContain('aria-pressed="false"');
  });

  test("a packaged build drops the tools and keeps the row", () => {
    const html = renderRow(false);
    expect(html).not.toContain("Events");
    expect(html).not.toContain("Flow");
    // The row is still the window's second drag surface.
    expect(html).toContain('<header class="toolbar" data-tauri-drag-region="deep">');
    expect(html).toContain('<div class="toolbar-cluster">');
  });

  test("with nothing to draw, the strut holds the row at a pill's height", () => {
    expect(renderRow(false)).toContain('class="toolbar-slot"');
  });

  test("the window's error line is drawn in a packaged build too", () => {
    expect(renderRow(false, { error: "Could not read the file" })).toContain("Could not read the file");
  });
});
