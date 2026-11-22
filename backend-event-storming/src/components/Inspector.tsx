import { useMemo, useState } from "react";
import { flattenSchema } from "../flow/schema";
import type { DtoMap, FieldMap, FlowGraph } from "../flow/types";
import type { Selection } from "../flow/layout";

/**
 * Details for the selected card.
 *
 * The reference has no inspector — it opens edit dialogs instead. This one is
 * styled with the same dark panel the reference uses for its modals
 * (`.modal-content`: #1e293b on a #475569 border), so it belongs to the same
 * design language without borrowing a component it never had.
 */

interface InspectorProps {
  graph: FlowGraph;
  selection: Selection;
  onClose: () => void;
}

interface Row {
  label: string;
  value: string;
}

interface Detail {
  tag: string;
  title: string;
  rows: Row[];
  rules: string[];
  schemas: { title: string; fields: FieldMap; dtos: DtoMap }[];
  links: { label: string; items: string[] }[];
  raw: unknown;
}

const join = (values: string[]): string => (values.length > 0 ? values.join(", ") : "—");

function emptyDetail(kind: string, name: string): Detail {
  return { tag: kind, title: name, rows: [], rules: [], schemas: [], links: [], raw: { name } };
}

function buildDetail(graph: FlowGraph, selection: Selection): Detail {
  const { kind, name } = selection;

  if (kind === "command") {
    const command = graph.commands.find((candidate) => candidate.name === name);
    if (!command) return emptyDetail(kind, name);
    const events = graph.events.filter((event) => command.emits.includes(event.name));
    return {
      tag: "Command",
      title: command.name,
      rows: [
        { label: "Context", value: command.context },
        { label: "Handler", value: command.handler ?? "—" },
        { label: "Transaction", value: command.transaction ?? "—" },
        { label: "Actors", value: join(command.actors) },
        ...(command.httpMethod
          ? [{ label: "HTTP", value: `${command.httpMethod} ${command.path ?? ""}` }]
          : []),
        ...(command.summary ? [{ label: "Summary", value: command.summary }] : []),
      ],
      rules: [],
      schemas:
        Object.keys(command.payload).length > 0
          ? [{ title: "Command payload", fields: command.payload, dtos: graph.dtos }]
          : [],
      links: [
        { label: "Emits", items: command.emits },
        { label: "Reaches policies", items: [...new Set(events.flatMap((event) => event.listenedBy))] },
      ],
      raw: command,
    };
  }

  if (kind === "event") {
    const event = graph.events.find((candidate) => candidate.name === name);
    if (!event) return emptyDetail(kind, name);
    return {
      tag: event.external ? "External event" : "Event",
      title: event.name,
      rows: [
        { label: "Context", value: event.context },
        {
          label: "Origin",
          value: event.external ? "outside this backend" : "emitted by a command handler",
        },
      ],
      rules: [],
      schemas:
        Object.keys(event.payload).length > 0
          ? [{ title: "Event payload", fields: event.payload, dtos: graph.dtos }]
          : [],
      links: [
        { label: "Emitted by", items: event.emittedBy },
        { label: "Listened by", items: event.listenedBy },
      ],
      raw: event,
    };
  }

  if (kind === "policy") {
    const policy = graph.policies.find((candidate) => candidate.name === name);
    if (!policy) return emptyDetail(kind, name);
    return {
      tag: "Policy",
      title: policy.name,
      rows: [
        { label: "Wildcard", value: policy.wildcard ? "listens to every event" : "no" },
        { label: "Listens to", value: join(policy.listensTo) },
        { label: "Sends", value: join(policy.sends) },
      ],
      rules: policy.rules,
      schemas: [],
      links: [
        { label: "Subscribed events", items: policy.listensTo.filter((item) => item !== "DomainEvent") },
        { label: "Dispatches", items: policy.sends },
        ...(policy.links.length > 0
          ? [
              {
                label: "Routes",
                items: policy.links.map(
                  (link) => `${link.fromEvent ?? "?"} → ${link.toCommand ?? "?"}`,
                ),
              },
            ]
          : []),
      ],
      raw: policy,
    };
  }

  if (kind === "query") {
    const query = graph.queries.find((candidate) => candidate.name === name);
    if (!query) return emptyDetail(kind, name);
    return {
      tag: "Query",
      title: query.name,
      rows: [
        { label: "Context", value: query.context },
        { label: "Handler", value: query.handler ?? "—" },
        { label: "Actors", value: join(query.actors) },
        ...(query.httpMethod
          ? [{ label: "HTTP", value: `${query.httpMethod} ${query.path ?? ""}` }]
          : []),
        ...(query.summary ? [{ label: "Summary", value: query.summary }] : []),
      ],
      rules: [],
      schemas: [
        ...(Object.keys(query.payload).length > 0
          ? [{ title: "Query parameters", fields: query.payload, dtos: graph.queryDtos }]
          : []),
        ...(Object.keys(query.resultPayload).length > 0
          ? [
              {
                title: `Returns ${query.resultName || "a result"}`,
                fields: query.resultPayload,
                dtos: graph.queryDtos,
              },
            ]
          : []),
      ],
      links: [{ label: "Started by", items: query.actors }],
      raw: query,
    };
  }

  if (kind === "result") {
    const query = graph.queries.find((candidate) => candidate.name === name);
    if (!query) return emptyDetail(kind, name);
    return {
      tag: "Read model",
      title: query.resultName || "Result",
      rows: [
        { label: "Returned by", value: query.name },
        { label: "Context", value: query.context },
      ],
      rules: [],
      schemas:
        Object.keys(query.resultPayload).length > 0
          ? [{ title: "Shape", fields: query.resultPayload, dtos: graph.queryDtos }]
          : [],
      links: [{ label: "Read by", items: query.actors }],
      raw: { query: query.name, result: query.resultName, payload: query.resultPayload },
    };
  }

  const commands = graph.commands.filter((command) => command.actors.includes(name));
  const queries = graph.queries.filter((query) => query.actors.includes(name));
  return {
    tag: "Actor",
    title: name,
    rows: [
      { label: "Commands", value: String(commands.length) },
      { label: "Queries", value: String(queries.length) },
      {
        label: "Contexts",
        value: join([...new Set([...commands, ...queries].map((item) => item.context))]),
      },
    ],
    rules: [],
    schemas: [],
    links: [
      { label: "Starts commands", items: commands.map((command) => command.name) },
      { label: "Runs queries", items: queries.map((query) => query.name) },
    ],
    raw: {
      actor: name,
      commands: commands.map((command) => command.name),
      queries: queries.map((query) => query.name),
    },
  };
}

export default function Inspector({ graph, selection, onClose }: InspectorProps) {
  const detail = useMemo(() => buildDetail(graph, selection), [graph, selection]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.raw, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="inspector" aria-label={`Details for ${detail.title}`}>
      <header className="inspector__head">
        <span className="inspector__badge">{detail.tag}</span>
        <button type="button" className="inspector__close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <h2 className="inspector__title">{detail.title}</h2>

      {detail.rows.length > 0 && (
        <dl className="inspector__rows">
          {detail.rows.map((row) => (
            <div className="inspector__row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {detail.links
        .filter((link) => link.items.length > 0)
        .map((link) => (
          <section className="inspector__section" key={link.label}>
            <h3>{link.label}</h3>
            <div className="inspector__chips">
              {link.items.map((item) => (
                <span className="inspector__chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </section>
        ))}

      {detail.rules.length > 0 && (
        <section className="inspector__section">
          <h3>Business rules</h3>
          <ul className="inspector__rules">
            {detail.rules.map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
          </ul>
        </section>
      )}

      {detail.schemas.map((schema) => {
        const lines = flattenSchema(schema.fields, schema.dtos);
        if (lines.length === 0) return null;
        return (
          <section className="inspector__section" key={schema.title}>
            <h3>{schema.title}</h3>
            <div className="inspector__schema">
              {lines.map((line, index) =>
                line.closeBrace ? (
                  <div
                    key={index}
                    className="inspector__schema-line"
                    style={{ paddingLeft: line.indent * 13, opacity: 0.5 }}
                  >
                    {"}"}
                    {line.closeArray ? "[]" : ""}
                  </div>
                ) : (
                  <div
                    key={index}
                    className="inspector__schema-line"
                    style={{ paddingLeft: line.indent * 13 }}
                  >
                    <strong>{line.fieldName}</strong>
                    <span style={{ opacity: 0.5 }}>: </span>
                    <em style={{ color: line.openDto ? "#93c5fd" : undefined }}>
                      {line.typeName}
                    </em>
                    {line.openDto ? " {" : ""}
                  </div>
                ),
              )}
            </div>
          </section>
        );
      })}

      <section className="inspector__section">
        <h3>
          JSON
          <button type="button" className="inspector__copy" onClick={copy}>
            {copied ? "copied" : "copy"}
          </button>
        </h3>
        <pre className="inspector__raw">{JSON.stringify(detail.raw, null, 2)}</pre>
      </section>
    </aside>
  );
}
