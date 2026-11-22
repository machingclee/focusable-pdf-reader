import { baseApi } from "./baseApi";

export interface AuditEvent {
  id: number;
  requestId: string;
  eventType: string;
  payload: string;
  eventOrder: number;
  requestUserEmail: string | null;
  success: boolean;
  failureReason: string;
  createdAt: number;
}

export interface AuditEventPage {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditEventQuery {
  page: number;
  limit: number;
  requestId?: string;
  eventType?: string;
  success?: boolean;
  sortOrder?: "asc" | "desc";
}

export const eventAuditApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEvents: builder.query<AuditEventPage, AuditEventQuery>({
      query: ({ page, limit, requestId, eventType, success, sortOrder }) => {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });
        if (requestId) params.set("requestId", requestId);
        if (eventType) params.set("eventType", eventType);
        if (success !== undefined) params.set("success", String(success));
        if (sortOrder) params.set("sortOrder", sortOrder);
        return `/event-audit?${params.toString()}`;
      },
    }),
  }),
});

export const { useGetEventsQuery } = eventAuditApi;
