import express from "express";
import type { Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import swaggerUi from "swagger-ui-express";
import { validate } from "../middleware/validate.ts";

// Zod 4 removed `ZodTypeAny`; `ZodType` is the base schema class in both v3 and v4.
type ZodSchema = z.ZodType;

// ── Types ────────────────────────────────────────────────────────────────

interface RouteDefinition<
  TBody extends ZodSchema | undefined = ZodSchema | undefined,
  TResp extends ZodSchema | undefined = ZodSchema | undefined,
> {
  method: "get" | "post" | "put" | "delete" | "patch";
  path: string;
  summary?: string;
  tags?: string[];
  bodySchema?: TBody;
  querySchema?: ZodSchema;
  /** Success response schema — infers res.json() type + auto-generates OpenAPI. */
  responseSchema?: TResp;
  /**
   * Status code the success response is documented under (default `200`).
   * Runtime validation still applies to any 2xx body.
   */
  successStatus?: number;
  /** Full response overrides (merges on top of responseSchema). */
  responses?: Record<string, { description: string; schema?: ZodSchema }>;
}

/**
 * Config object passed as the second argument to app.get/post/put/delete/patch.
 * TBody: inferred from bodySchema (or undefined).
 * TResp: inferred from responseSchema (or undefined).
 */
export type EndpointConfig<
  TBody extends ZodSchema | undefined = undefined,
  TResp extends ZodSchema | undefined = undefined,
> = Omit<RouteDefinition<TBody, TResp>, "method" | "path">;

/** Request with body typed from bodySchema. */
type TypedRequest<TBody extends ZodSchema | undefined> = TBody extends ZodSchema
  ? Omit<Request, "body"> & { body: z.infer<TBody> }
  : Request;

/** Response with json() narrowed to the responseSchema type. */
type TypedResponse<TResp extends ZodSchema | undefined> = TResp extends ZodSchema
  ? Omit<Response, "json"> & {
      json(body: z.infer<TResp>): Response;
      status(code: number): TypedResponse<TResp>;
    }
  : Response;

type TypedHandler<TBody extends ZodSchema | undefined, TResp extends ZodSchema | undefined> = (
  req: TypedRequest<TBody>,
  res: TypedResponse<TResp>,
) => void | Promise<void>;

// ── Augmented Express app ─────────────────────────────────────────────────

interface DocAppMethods {
  // Overload 1: bodySchema + responseSchema — req.body + res.json both typed
  get<TBody extends ZodSchema, TResp extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, TResp>,
    handler: TypedHandler<TBody, TResp>,
  ): void;
  // Overload 2: bodySchema only — req.body typed, res.json any
  get<TBody extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, undefined>,
    handler: TypedHandler<TBody, undefined>,
  ): void;
  // Overload 3: no schemas — plain Express
  get(
    path: string,
    config: EndpointConfig<undefined, undefined>,
    handler: TypedHandler<undefined, undefined>,
  ): void;
  // Overload 4: plain Express — no config
  get(path: string, handler: RequestHandler): void;

  post<TBody extends ZodSchema, TResp extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, TResp>,
    handler: TypedHandler<TBody, TResp>,
  ): void;
  post<TBody extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, undefined>,
    handler: TypedHandler<TBody, undefined>,
  ): void;
  post(
    path: string,
    config: EndpointConfig<undefined, undefined>,
    handler: TypedHandler<undefined, undefined>,
  ): void;
  post(path: string, handler: RequestHandler): void;

  put<TBody extends ZodSchema, TResp extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, TResp>,
    handler: TypedHandler<TBody, TResp>,
  ): void;
  put<TBody extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, undefined>,
    handler: TypedHandler<TBody, undefined>,
  ): void;
  put(
    path: string,
    config: EndpointConfig<undefined, undefined>,
    handler: TypedHandler<undefined, undefined>,
  ): void;
  put(path: string, handler: RequestHandler): void;

  delete<TBody extends ZodSchema, TResp extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, TResp>,
    handler: TypedHandler<TBody, TResp>,
  ): void;
  delete<TBody extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, undefined>,
    handler: TypedHandler<TBody, undefined>,
  ): void;
  delete(
    path: string,
    config: EndpointConfig<undefined, undefined>,
    handler: TypedHandler<undefined, undefined>,
  ): void;
  delete(path: string, handler: RequestHandler): void;

  patch<TBody extends ZodSchema, TResp extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, TResp>,
    handler: TypedHandler<TBody, TResp>,
  ): void;
  patch<TBody extends ZodSchema>(
    path: string,
    config: EndpointConfig<TBody, undefined>,
    handler: TypedHandler<TBody, undefined>,
  ): void;
  patch(
    path: string,
    config: EndpointConfig<undefined, undefined>,
    handler: TypedHandler<undefined, undefined>,
  ): void;
  patch(path: string, handler: RequestHandler): void;
}

export type DocApp = ReturnType<typeof express> & DocAppMethods;

// ── Registry ──────────────────────────────────────────────────────────────

const registry: RouteDefinition[] = [];

const CONFIG_KEYS = ["bodySchema", "responseSchema", "querySchema", "summary", "tags", "responses", "successStatus"];

/** Checks whether the argument is an EndpointConfig (not a handler or internal Express arg). */
function isConfig(obj: unknown): obj is EndpointConfig {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || typeof obj === "function") return false;
  return CONFIG_KEYS.some((key) => key in obj);
}

// ── Doc app and Doc router ────────────────────────────────────────────────

/**
 * Joins a router's mount path with a path declared inside it, so the registry
 * (and therefore the OpenAPI document) records `/pdf-documents/:id` rather than
 * `/:id`. `createDocApp` passes an empty prefix, which leaves paths untouched.
 */
function joinPaths(prefix: string, path: string): string {
  const base = prefix.replace(/\/+$/, "");
  if (!base) return path;
  if (path === "/" || path === "") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Creates an Express app with FastAPI-style route registration:
 *
 *   app.post("/focusable-strips", {
 *     bodySchema: CreateStripBodySchema,
 *     responseSchema: FocusableStripSchema,
 *     summary: "Save a strip",
 *   }, async (req, res) => {
 *     const { page_number } = req.body;   // typed, already validated
 *     res.status(201).json(strip);       // checked against responseSchema
 *   });
 *
 * Routes registered without a config object behave exactly like plain Express.
 */
export function createDocApp(): DocApp {
  const app = express() as DocApp;
  applyDocMethods(app, "");
  return app;
}

/** An Express `Router` whose verbs accept the same config object as `DocApp`. */
export type DocRouter = ReturnType<typeof express.Router> & DocAppMethods;

/**
 * Creates a `Router` with FastAPI-style route registration, recording every
 * route under `mountPath` so the generated document keeps full paths.
 *
 *   // routers/focusableStripsRouter.ts
 *   const router = createDocRouter("/focusable-strips");
 *   router.post("/", { bodySchema, responseSchema }, handler);
 *
 *   // app.ts
 *   app.use("/focusable-strips", focusableStripsRouter);
 */
export function createDocRouter(mountPath: string): DocRouter {
  const router = express.Router() as DocRouter;
  applyDocMethods(router, mountPath);
  return router;
}

/** Installs the config-aware verbs on an app or a router. */
function applyDocMethods(target: any, prefix: string): void {
  const methods = ["get", "post", "put", "delete", "patch"] as const;
  for (const method of methods) {
    const original = (target as any)[method].bind(target) as (...args: any[]) => any;

    (target as any)[method] = function (this: any, path: string, configOrHandler: any, maybeHandler?: any) {
      if (isConfig(configOrHandler)) {
        const config = configOrHandler;
        const fullPath = joinPaths(prefix, path);
        let handler: RequestHandler = maybeHandler;
        const middleware: RequestHandler[] = [];
        if (config.bodySchema) {
          middleware.push(validate(config.bodySchema));
        }
        // Wrap the handler so its 2xx JSON body is checked against responseSchema.
        if (config.responseSchema) {
          const responseSchema = config.responseSchema;
          const userHandler = handler;
          handler = (req, res, next) => {
            const originalJson = res.json.bind(res);
            res.json = function (this: any, body: any) {
              const status = this.statusCode || 200;
              if (status >= 200 && status < 300 && body !== undefined) {
                const result = (responseSchema as ZodSchema).safeParse(body);
                if (!result.success) {
                  console.error(
                    `[response validation] ${method.toUpperCase()} ${fullPath} body does not match responseSchema:`,
                    result.error.issues,
                  );
                  this.status(500);
                  return originalJson({ error: "Internal server error" });
                }
                return originalJson(result.data);
              }
              return originalJson(body);
            } as any;
            return userHandler(req, res, next);
          };
        }
        registry.push({ method, path: fullPath, ...config });
        return original(path, ...middleware, handler);
      }
      // Plain Express — only forward defined arguments so Express's
      // arg-count-based dispatch (route vs settings getter) works.
      if (arguments.length === 1 || configOrHandler === undefined) {
        return original(path);
      }
      if (arguments.length === 2) {
        return original(path, configOrHandler);
      }
      return original(path, configOrHandler, maybeHandler);
    };
  }
}

// ── OpenAPI generation ────────────────────────────────────────────────────

/** Zod internals live in `_zod.def` (v4) or `_def` (v3/v4 legacy). */
function defOf(schema: ZodSchema): any {
  return (schema as any)._zod?.def ?? (schema as any)._def ?? {};
}

/** Get the type string (e.g. "string", "object") from a Zod schema. Works across v3/v4. */
function zodType(schema: ZodSchema): string {
  const def = defOf(schema);
  return def.type ?? def.typeName ?? "";
}

function checksOf(schema: ZodSchema): any[] {
  return defOf(schema).checks ?? [];
}

/**
 * Zod 4 stores checks as instances whose payload is `check._zod.def`
 * (`{ check: "min_length", minimum: 3 }`); Zod 3 used plain `{ kind: "min", value }`.
 */
function checkDefOf(check: any): any {
  return check?._zod?.def ?? check ?? {};
}

/** Returns the inner type for optional/default/nullable wrappers, or the schema itself. */
function unwrap(schema: ZodSchema): ZodSchema {
  const inner = defOf(schema).innerType;
  return inner ? unwrap(inner as ZodSchema) : schema;
}

/** Get the shape object from a ZodObject, handling v3 (fn) vs v4 (plain object). */
function getShape(schema: ZodSchema): Record<string, ZodSchema> {
  const shape = defOf(schema).shape;
  return typeof shape === "function" ? shape() : (shape ?? {});
}

function isRequiredField(schema: ZodSchema): boolean {
  const type = zodType(schema);
  return type !== "optional" && type !== "default" && type !== "ZodOptional" && type !== "ZodDefault";
}

function zodToOpenApiSchema(schema: ZodSchema): Record<string, unknown> {
  const rawType = zodType(schema);

  // Wrappers first: nullability and defaults both have to survive the unwrap.
  if (rawType === "nullable" || rawType === "ZodNullable") {
    return { ...zodToOpenApiSchema(unwrap(schema)), nullable: true };
  }

  const inner = unwrap(schema);
  const type = zodType(inner);

  if (type === "string" || type === "ZodString") {
    const result: Record<string, unknown> = { type: "string" };
    for (const check of checksOf(inner)) {
      const def = checkDefOf(check);
      const kind = def.check ?? def.kind;
      if (kind === "min_length" || kind === "min") result.minLength = def.minimum ?? def.value;
      if (kind === "max_length" || kind === "max") result.maxLength = def.maximum ?? def.value;
    }
    return result;
  }

  if (type === "number" || type === "ZodNumber") {
    const result: Record<string, unknown> = { type: "number" };
    for (const check of checksOf(inner)) {
      const def = checkDefOf(check);
      const kind = def.check ?? def.kind;
      if (kind === "number_format" && (def.format === "safeint" || def.format === "int")) result.type = "integer";
      if (kind === "int" || kind === "ZodNumberInt") result.type = "integer";
      if (kind === "greater_than" || kind === "min") {
        if (def.inclusive === false) result.exclusiveMinimum = def.value;
        else result.minimum = def.value ?? def.minimum;
      }
      if (kind === "less_than" || kind === "max") {
        if (def.inclusive === false) result.exclusiveMaximum = def.value;
        else result.maximum = def.value ?? def.maximum;
      }
    }
    return result;
  }

  if (type === "boolean" || type === "ZodBoolean") return { type: "boolean" };

  if (type === "enum" || type === "ZodEnum") {
    const def = defOf(inner);
    const values = def.values ?? def.entries;
    return { type: "string", enum: Array.isArray(values) ? values : Object.values(values ?? {}) };
  }

  // OpenAPI 3.0 has no `const`, so a literal becomes a single-value enum.
  if (type === "literal" || type === "ZodLiteral") {
    const values = defOf(inner).values ?? [defOf(inner).value];
    return { type: typeof values[0] === "number" ? "number" : "string", enum: values };
  }

  if (type === "array" || type === "ZodArray") {
    const def = defOf(inner);
    return { type: "array", items: zodToOpenApiSchema((def.element ?? def.type) as ZodSchema) };
  }

  if (type === "object" || type === "ZodObject") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(getShape(inner))) {
      properties[key] = zodToOpenApiSchema(fieldSchema as ZodSchema);
      if (isRequiredField(fieldSchema as ZodSchema)) required.push(key);
    }
    const result: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) result.required = required;
    return result;
  }

  return { type: "string" };
}

/** Attach a Zod `.describe()` to the generated schema when one is present. */
function describeOf(schema: ZodSchema): string | undefined {
  const description = (schema as any).description ?? defOf(schema).description;
  return typeof description === "string" ? description : undefined;
}

function withDescription(schema: ZodSchema, openApi: Record<string, unknown>): Record<string, unknown> {
  const description = describeOf(schema);
  return description ? { ...openApi, description } : openApi;
}

export function generateOpenApiDoc(title: string, version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagNames = new Set<string>();

  for (const def of registry) {
    if (def.tags) def.tags.forEach((tag) => tagNames.add(tag));
    const pathItem: Record<string, unknown> = paths[def.path] || {};
    const operation: Record<string, unknown> = {
      summary: def.summary || `${def.method.toUpperCase()} ${def.path}`,
      tags: def.tags || [],
    };

    if (def.bodySchema) {
      (operation as any).requestBody = {
        required: true,
        content: { "application/json": { schema: withDescription(def.bodySchema, zodToOpenApiSchema(def.bodySchema)) } },
      };
    }

    if (def.querySchema) {
      (operation as any).parameters = Object.entries(getShape(def.querySchema)).map(([name, fieldSchema]) => ({
        name,
        in: "query",
        required: isRequiredField(fieldSchema as ZodSchema),
        schema: withDescription(fieldSchema as ZodSchema, zodToOpenApiSchema(fieldSchema as ZodSchema)),
      }));
    }

    const baseResponses: Record<string, { description: string; schema?: ZodSchema }> = {};
    if (def.responseSchema) {
      baseResponses[String(def.successStatus ?? 200)] = { description: "OK", schema: def.responseSchema };
    }
    if (def.responses) {
      Object.assign(baseResponses, def.responses);
    }
    if (Object.keys(baseResponses).length === 0) {
      baseResponses["200"] = { description: "OK" };
    }

    const openApiResponses: Record<string, unknown> = {};
    for (const [statusCode, responseDef] of Object.entries(baseResponses)) {
      const entry: Record<string, unknown> = { description: responseDef.description };
      if (responseDef.schema) {
        entry.content = {
          "application/json": { schema: withDescription(responseDef.schema, zodToOpenApiSchema(responseDef.schema)) },
        };
      }
      openApiResponses[statusCode] = entry;
    }
    (operation as any).responses = openApiResponses;

    pathItem[def.method] = operation;
    paths[def.path] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: { title, version },
    tags: [...tagNames].sort().map((name) => ({ name })),
    paths,
  };
}

// ── Swagger UI ────────────────────────────────────────────────────────────

/**
 * Serves the generated document at `/api-docs.json` and Swagger UI at
 * `/api-docs`. The document is built eagerly, so this has to run after every
 * route is registered and before the not-found handler.
 */
export function setupSwagger(
  app: DocApp,
  opts: { jsonPath?: string; uiPath?: string; title?: string; version?: string } = {},
): void {
  const { jsonPath = "/api-docs.json", uiPath = "/api-docs", title = "API", version = "1.0.0" } = opts;

  const doc = generateOpenApiDoc(title, version);

  app.get(jsonPath, (_req, res) => res.json(doc));
  app.use(uiPath, swaggerUi.serve, swaggerUi.setup(doc));
}
