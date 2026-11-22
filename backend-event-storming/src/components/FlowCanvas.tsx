import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import GroupNode from "./nodes/GroupNode";
import LabelNode from "./nodes/LabelNode";
import PolicyNode from "./nodes/PolicyNode";
import SpreadStepEdge from "./edges/SpreadStepEdge";
import { parseNodeId, type Selection } from "../flow/layout";

/**
 * The canvas of `echarge-event-storming-component`: same node/edge types, same
 * pane behaviour (left-drag on a card moves it, space or middle-drag pans) and
 * the same mini-map colouring.
 */

const nodeTypes = {
  labelNode: LabelNode,
  policyNode: PolicyNode,
  groupNode: GroupNode,
};

const edgeTypes = { spreadStep: SpreadStepEdge };

/**
 * Space + left-drag or middle-click/right-drag pans. Left-drag on a card moves
 * that card, which is React Flow's own behaviour, so panning has to be explicit.
 */
function SpaceOrMiddleDragPan() {
  const { getViewport, setViewport } = useReactFlow();
  const spaceHeld = useRef(false);
  const panning = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !event.repeat) spaceHeld.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector(".react-flow") as HTMLElement | null;
    if (!root) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".react-flow__edge,.react-flow__controls,.nowheel")) return;
      const shouldPan =
        event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeld.current);
      if (!shouldPan) return;
      event.preventDefault();
      panning.current = true;
      last.current = { x: event.clientX, y: event.clientY };
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!panning.current) return;
      const dx = last.current.x - event.clientX;
      const dy = last.current.y - event.clientY;
      last.current = { x: event.clientX, y: event.clientY };
      const viewport = getViewport();
      setViewport({ x: viewport.x - dx, y: viewport.y - dy, zoom: viewport.zoom });
    };

    const onMouseUp = () => {
      panning.current = false;
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [getViewport, setViewport]);

  return null;
}

interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  /** Width of the laid-out drawing, for the initial framing. */
  contentWidth: number;
  /** Ids of the nodes that match the current search, for Enter-stepping. */
  matches: string[];
  /** Changes when the drawing should be re-fitted (new graph or tab). */
  fitKey: string;
  /**
   * Changes whenever the geometry changes (graph, tab, payload expansion).
   * Positions are taken from the layout then; a search keystroke must not move a
   * card the user has dragged, so it is not part of this key.
   */
  layoutKey: string;
  /** Increments when Enter is pressed in the search box. */
  focusNonce: number;
  onSelect: (selection: Selection | null) => void;
}

export default function FlowCanvas({
  nodes: incomingNodes,
  edges,
  contentWidth,
  matches,
  fitKey,
  layoutKey,
  focusNonce,
  onSelect,
}: FlowCanvasProps) {
  const { setCenter, getZoom, setViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fitted = useRef("");
  const matchCursor = useRef(0);

  /**
   * Drag needs React Flow to own the positions: the `nodes` prop is a snapshot,
   * and a drag only sticks if the changes it reports are applied back. The
   * merge below keeps the user's positions when only the search/selection
   * highlight changes, and takes the freshly computed layout — positions
   * included — when the graph or tab changes.
   */
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const replaceLayout = useRef(true);

  useEffect(() => {
    replaceLayout.current = true;
  }, [layoutKey]);

  useEffect(() => {
    setNodes((previous) => {
      const replace = replaceLayout.current;
      replaceLayout.current = false;
      const previousById = new Map(previous.map((node) => [node.id, node]));
      return incomingNodes.map((node) => {
        const existing = previousById.get(node.id);
        if (!existing || replace) return node;
        return {
          ...node,
          position: existing.position,
          dragging: existing.dragging,
          selected: existing.selected,
        };
      });
    });
  }, [incomingNodes, setNodes]);

  /**
   * Open at a readable zoom.
   *
   * The reference calls `fitView` once, which is right for its graphs; a context
   * with a dozen commands is far taller than the viewport, so fitting everything
   * would land at ~0.35 and turn the labels to mush. Framing the width and
   * anchoring the top keeps the notes at close to their real size, and the
   * controls' fit button (plus the toolbar's Fit) still gives the overview.
   */
  const frame = useCallback(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const available = Math.max(320, element.clientWidth - 80);
    const zoom = Math.min(1, Math.max(0.25, available / Math.max(contentWidth, 1)));
    setViewport({ x: 40, y: 44, zoom }, { duration: 0 });
  }, [contentWidth, setViewport]);

  // Re-frame once per graph/tab. Two attempts: React Flow may still be measuring
  // the cards when the first one lands.
  useEffect(() => {
    if (fitted.current === fitKey) return;
    const timers = [80, 340].map((delay) =>
      window.setTimeout(() => {
        frame();
        if (delay === 340) fitted.current = fitKey;
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [fitKey, frame]);

  // Enter in the search box steps through the matches.
  useEffect(() => {
    if (focusNonce === 0) return;
    if (matches.length === 0) return;
    const targets = nodes.filter((node) => matches.includes(node.id));
    if (targets.length === 0) return;
    const target = targets[matchCursor.current % targets.length];
    matchCursor.current += 1;
    const width = target.measured?.width ?? (target.width as number | undefined) ?? 480;
    const height = target.measured?.height ?? (target.height as number | undefined) ?? 120;
    setCenter(target.position.x + width / 2, target.position.y + height / 2, {
      zoom: Math.max(getZoom(), 0.85),
      duration: 450,
    });
  }, [focusNonce, matches, incomingNodes, setCenter, getZoom]);

  // Escape clears the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const parsed = parseNodeId(node.id);
      onSelect(parsed);
    },
    [onSelect],
  );

  if (incomingNodes.length === 0) {
    return (
      <div className="flow-empty">
        <h2>Nothing to draw</h2>
        <p>
          No commands or queries were found in this JSON. Load another file, or reload{" "}
          <code>/docs/commands</code>.
        </p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ position: "absolute", inset: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.05}
        attributionPosition="bottom-left"
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        panOnDrag={false}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
      >
        <SpaceOrMiddleDragPan />
        <Background />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.type === "groupNode") return "#334155";
            if (node.id.startsWith("actor:")) return "#eab308";
            if (node.id.startsWith("command:")) return "#2563eb";
            if (node.id.startsWith("event:")) return "#f97316";
            if (node.id.startsWith("query:")) return "#2563eb";
            if (node.id.startsWith("result:")) return "#f97316";
            if (node.id.startsWith("policy:")) {
              return (
                getComputedStyle(document.documentElement)
                  .getPropertyValue("--policy-bg")
                  .trim() || "#a78bba"
              );
            }
            return "#64748b";
          }}
        />
      </ReactFlow>
    </div>
  );
}
