import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { POLICY_NODE_WIDTH } from "../../flow/theme";
import type { PolicyNodeData } from "../../flow/layout";

/**
 * The policy card of `echarge-event-storming-component`, read-only: the policy
 * name across the top, an "Invariants" heading, then one numbered block per
 * business rule with the event → command routing it justifies.
 *
 * Colours come from the CSS variables the reference sets in `index.css`
 * (`--policy-bg`, `--policy-border`), so the card matches its stylesheet rather
 * than carrying hard-coded purples.
 */
export default function PolicyNode({ data }: NodeProps<Node<PolicyNodeData>>) {
  return (
    <div
      style={{
        background: "var(--policy-bg)",
        border: "2px solid var(--policy-border)",
        borderRadius: "8px",
        padding: "10px 14px",
        color: "#fff",
        width: POLICY_NODE_WIDTH,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          letterSpacing: "0.05em",
          opacity: 0.9,
          fontSize: 30,
          marginBottom: "8px",
          paddingBottom: "6px",
          borderBottom: "1px solid rgba(255,255,255,0.45)",
          wordBreak: "break-word",
          textAlign: "center",
        }}
      >
        <span>{data.label}</span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          fontSize: "24px",
          letterSpacing: "0.05em",
          opacity: 0.85,
          marginBottom: "6px",
        }}
      >
        Invariants
      </div>

      <ul style={{ margin: 0, paddingLeft: "16px", listStyleType: "none" }}>
        {data.flows.map((flow, index) => (
          <li
            key={index}
            style={{
              position: "relative",
              marginBottom: "10px",
              borderRadius: "6px",
              padding: "8px 10px",
            }}
          >
            <div
              style={{ fontSize: "20px", lineHeight: 1.2, marginBottom: "4px" }}
              className="markdown-invariant"
            >
              <div style={{ display: "flex" }}>
                <div
                  style={{
                    marginRight: "8px",
                    opacity: 0.6,
                    fontSize: "18px",
                    fontStyle: "italic",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      padding: "4px 6px",
                    }}
                  >
                    {String(index + 1).padStart(2, "0")}.
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ marginBottom: 10 }}>
                    {flow.invariant || (
                      <span style={{ fontStyle: "italic", opacity: 0.6 }}>No rule text</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {flow.fromEvent ? (
                      <span
                        style={{
                          display: "inline-block",
                          background: "rgba(249,115,22,0.85)",
                          border: "1px solid rgba(255,255,255,0.4)",
                          borderRadius: "4px",
                          padding: "1px 7px",
                          fontSize: "16px",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {flow.fromEvent}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-block",
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          padding: "1px 7px",
                          fontSize: "14px",
                          fontStyle: "italic",
                          opacity: 0.7,
                        }}
                      >
                        No Event
                      </span>
                    )}
                    <span style={{ fontSize: "11px", opacity: 0.7 }}>→</span>
                    {flow.toCommand ? (
                      <span
                        style={{
                          display: "inline-block",
                          background: "rgba(37,99,235,0.85)",
                          border: "1px solid rgba(255,255,255,0.4)",
                          borderRadius: "4px",
                          padding: "1px 7px",
                          fontSize: "16px",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {flow.toCommand}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-block",
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          padding: "1px 7px",
                          fontSize: "14px",
                          fontStyle: "italic",
                          opacity: 0.7,
                        }}
                      >
                        No Command
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
