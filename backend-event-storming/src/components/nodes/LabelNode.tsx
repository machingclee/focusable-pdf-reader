import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { flattenSchema } from "../../flow/schema";
import type { LabelNodeData } from "../../flow/layout";
import type { SchemaLine } from "../../flow/types";

/**
 * The label card of `echarge-event-storming-component`, ported: a centred label
 * (left-aligned with a person glyph for actors), an optional summary, the HTTP
 * row and a collapsible payload schema.
 *
 * The card's background, border, padding, font size and width live on the React
 * Flow node itself (`flow/theme.ts`), exactly as in the reference — this
 * component only renders what goes inside the sticky note.
 */

const monoFont = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

/** Stick-figure actor glyph — the reference's `person` icon. */
const PersonIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="5" r="3" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="12" y1="16" x2="8" y2="21" />
    <line x1="12" y1="16" x2="16" y2="21" />
  </svg>
);

const iconMap: Record<string, React.ReactNode> = {
  person: <PersonIcon />,
};

function SchemaLineView({ line }: { line: SchemaLine }) {
  const padLeft = line.indent * 14;

  if (line.closeBrace) {
    return (
      <div
        style={{
          paddingLeft: padLeft,
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          opacity: 0.5,
          fontSize: "10px",
          lineHeight: 1.5,
        }}
      >
        {"}"}
        {line.closeArray && <span style={{ fontFamily: monoFont }}>[]</span>}
      </div>
    );
  }

  return (
    <div
      style={{
        paddingLeft: padLeft,
        display: "flex",
        alignItems: "baseline",
        gap: 4,
        fontSize: "11px",
        lineHeight: 1.5,
        color: "rgba(255,255,255,0.9)",
      }}
    >
      <span style={{ fontWeight: 600, opacity: 0.9, fontFamily: monoFont }}>
        {line.fieldName}
      </span>
      <span style={{ opacity: 0.45 }}>:</span>
      {line.openDto ? (
        <>
          <span style={{ fontFamily: monoFont, opacity: 0.7, color: "#93c5fd" }}>
            {line.typeName}
          </span>
          <span style={{ fontFamily: monoFont, fontSize: "10px", opacity: 0.45 }}>{"{"}</span>
        </>
      ) : (
        <span style={{ fontStyle: "italic", opacity: 0.8, fontFamily: monoFont }}>
          {line.typeName}
        </span>
      )}
    </div>
  );
}

export default function LabelNode({ id, data }: NodeProps<Node<LabelNodeData>>) {
  const showSchema = data.schemaExpanded ?? false;
  const schemaLines = data.payload ? flattenSchema(data.payload, data.dtos, 0, new Set()) : null;

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          display: "flex",
          alignItems: data.icon ? "flex-start" : "center",
          gap: 6,
          textAlign: data.icon ? "left" : "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        {data.icon && iconMap[data.icon] ? iconMap[data.icon] : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: data.icon ? "flex-start" : "center",
              justifyContent: data.icon ? "flex-start" : "center",
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              style={
                data.icon
                  ? {
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      lineHeight: 1.25,
                    }
                  : undefined
              }
            >
              {data.label}
            </span>
          </div>

          {data.summary && (
            <div
              style={{
                marginTop: 6,
                fontSize: "13px",
                fontWeight: 500,
                lineHeight: 1.35,
                opacity: 0.95,
                color: "rgba(255,255,255,0.95)",
              }}
            >
              {data.summary}
            </div>
          )}

          {data.httpMethod && (
            <div
              style={{
                marginTop: data.summary ? 8 : 6,
                fontSize: "12px",
                fontWeight: 500,
                opacity: 0.85,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <tbody>
                  <tr>
                    <td style={{ width: "15%", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          background: "rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          padding: "1px 6px",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {data.httpMethod}
                      </span>
                    </td>
                    <td style={{ width: "85%", textAlign: "left", paddingLeft: 6 }}>
                      <span style={{ wordBreak: "break-all" }}>{data.path}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {schemaLines && schemaLines.length > 0 && (
            <div
              style={{
                marginTop: data.summary || data.httpMethod ? 8 : 6,
                fontSize: "12px",
                fontWeight: 500,
                opacity: 0.9,
              }}
            >
              <div
                onClick={(event) => {
                  event.stopPropagation();
                  data.onToggleSchema?.(id);
                }}
                title={showSchema ? "Hide schema" : "Show schema"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                  background: showSchema ? "rgba(96,165,250,0.3)" : "rgba(255,255,255,0.12)",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  userSelect: "none",
                  transition: "background 0.15s",
                }}
              >
                <span style={{ fontSize: "10px" }}>{showSchema ? "▾" : "▸"}</span>
                Schema
                <span style={{ fontWeight: 400, opacity: 0.55, fontSize: "10px" }}>
                  ({schemaLines.length})
                </span>
              </div>
              {showSchema && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(0,0,0,0.22)",
                    borderRadius: "5px",
                    padding: "5px 8px",
                    gap: 1,
                    marginTop: 6,
                  }}
                >
                  {schemaLines.map((line, index) => (
                    <SchemaLineView key={index} line={line} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
