/**
 * The visual constants of `echarge-event-storming-component`, copied so the
 * diagram here looks like the one there.
 *
 * Values are taken verbatim from that project:
 *   constants.ts                      → the column X positions, node widths, spacing
 *   hooks/useLayoutEngine.ts          → the node style objects (colours, borders, padding)
 *   components/nodes/PolicyNode.tsx   → the policy card's own colours (`--policy-bg`)
 *   components/nodes/GroupNode.tsx    → the bounded-context box and its badge
 *
 * Keep this file a mirror: when the reference changes a colour, change it here
 * rather than inventing a variant.
 */

export const FONT_SIZE = "16px";
export const NODE_WIDTH = "480px";
export const ACTOR_NODE_WIDTH = "160px";
export const POLICY_NODE_WIDTH = "600px";

/** Column X positions on the canvas (absolute). */
export const ACTOR_X = 40;
export const COMMAND_X = 280;
export const EVENT_X = 860;
export const POLICY_X = 1500;

/** Vertical gap between stacked command blocks inside a context, and between contexts. */
export const VERTICAL_SPACING = 170;
export const CONTEXT_GAP = 60;

export const NODE_WIDTH_PX = 480;
export const ACTOR_NODE_WIDTH_PX = 160;

/** Group box inset: content starts this far inside the rounded frame. */
export const GROUP_PADDING = 24;
/** Extra top inset so the floating context badge (top: -18px) clears the first card. */
export const GROUP_TOP_PADDING = 56;
/** Gap between a context's command blocks (commands + their events). */
export const COMMAND_BLOCK_GAP = 48;
/** Gap between stacked event cards of one command. */
export const EVENT_STACK_GAP = 100;
/** Horizontal gap between a query and its read model. */
export const QUERY_COLUMN_GAP = 60;

/** Card colours — `style.background` / `style.border` of the React Flow node. */
export const COMMAND_STYLE = {
  background: "rgba(37,99,235,0.8)",
  color: "#fff",
  border: "2px solid #1d4ed8",
  borderRadius: "8px",
  padding: "10px",
  fontSize: FONT_SIZE,
  width: NODE_WIDTH,
} as const;

export const EVENT_STYLE = {
  background: "rgba(249,115,22,0.8)",
  color: "#fff",
  border: "2px solid #ea580c",
  borderRadius: "8px",
  padding: "10px",
  fontSize: FONT_SIZE,
  width: NODE_WIDTH,
} as const;

export const ACTOR_STYLE = {
  background: "rgba(250,204,21,0.9)",
  color: "#1c1917",
  border: "2px solid #ca8a04",
  fontSize: FONT_SIZE,
  borderRadius: "8px",
  padding: "10px",
  width: ACTOR_NODE_WIDTH,
  fontWeight: 700,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
} as const;

/** Read models reuse the event colour, as in the reference query layout. */
export const RESULT_STYLE = EVENT_STYLE;

/** Edge colours (all edges are `spreadStep`, strokeWidth 2, arrowClosed). */
export const ACTOR_EDGE_COLOR = "#ca8a04";
export const FLOW_EDGE_COLOR = "#64748b";
/** `--policy-border` from index.css; the reference reads it from the DOM. */
export const POLICY_EDGE_COLOR = "#8b6fa3";
