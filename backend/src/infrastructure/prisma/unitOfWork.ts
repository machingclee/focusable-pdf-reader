/**
 * Prisma implementation of the library's transaction port.
 *
 * `run` opens one interactive transaction and publishes its client through
 * AsyncLocalStorage, so repositories/handlers can call `db()` without being
 * handed a client through every signature. `isActive()` is what lets a nested
 * command reuse the ambient transaction instead of opening a second one
 * (SQLite would deadlock/serialise and the audit ordering would be wrong).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TransactionRunner } from "express-prisma-cqrs";
import type { AppPrisma } from "./client.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

export class PrismaUnitOfWork implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly client: AppPrisma) { }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => this.storage.run(tx, fn), {
      // A PDF import hashes and copies a file inside the required transaction.
      // Prisma's default interactive timeout is 5 seconds, which is too short
      // for a large book.
      maxWait: 5_000,
      timeout: 60_000,
    });
  }

  isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** The transaction client inside `run`, otherwise the root client. */
  db(): Prisma.TransactionClient {
    return this.storage.getStore() ?? this.client;
  }
}
