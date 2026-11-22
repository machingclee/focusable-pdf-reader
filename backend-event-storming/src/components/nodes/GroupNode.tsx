import type { NodeProps, Node } from "@xyflow/react";
import type { GroupNodeData } from "../../flow/layout";

/**
 * The bounded-context box of `echarge-event-storming-component`, ported.
 *
 * The frame itself ignores pointer events so clicks reach the cards inside; the
 * floating label badge re-enables them and doubles as the group's drag handle —
 * drag it and every card in the context moves with it.
 */
export default function GroupNode({ data }: NodeProps<Node<GroupNodeData>>) {
  const isSub = data.depth > 0;

  return (
    <div
      title={data.fullName}
      style={{
        width: "100%",
        height: "100%",
        border: isSub
          ? "1px dashed rgba(148,163,184,0.25)"
          : "1px solid rgba(148,163,184,0.3)",
        borderRadius: isSub ? "8px" : "12px",
        backgroundColor: isSub ? "rgba(135,185,250,0.08)" : "rgba(135,185,250,0.2)",
        position: "relative",
        // Let pointer events fall through to React Flow's node wrapper so child
        // nodes receive clicks first.
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: isSub ? "-14px" : "-18px",
          left: isSub ? "20px" : "16px",
          background: isSub ? "rgba(55,65,81,0.75)" : "rgba(30, 64, 175, 0.85)",
          padding: isSub ? "4px 12px" : "6px 20px",
          fontSize: isSub ? "16px" : "24px",
          color: "#e2e8f0",
          fontWeight: 700,
          borderRadius: isSub ? "6px" : "8px",
          whiteSpace: "nowrap",
          border: isSub
            ? "1px solid rgba(148,163,184,0.2)"
            : "1px solid rgba(96, 165, 250, 0.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          // Re-enable pointer events on the badge so it remains clickable and
          // serves as a drag handle for the group.
          pointerEvents: "auto",
        }}
      >
        {isSub && <span style={{ opacity: 0.45, fontSize: "12px", fontWeight: 500 }}>↳</span>}
        {isSub ? data.label : data.fullName}
      </span>
    </div>
  );
}
