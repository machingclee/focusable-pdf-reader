import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { GetAppStateQuery } from "../query/GetAppStateQuery.ts";

/** Every remembered value, as a flat `key -> value` map. */
@QueryHandler(GetAppStateQuery, { inject: [PrismaUnitOfWork] })
export class GetAppStateQueryHandler
  implements IQueryHandler<GetAppStateQuery, Record<string, string>> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(): Promise<Record<string, string>> {
    const rows = await this.uow.db().app_state.findMany();
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    return map;
  }
}
