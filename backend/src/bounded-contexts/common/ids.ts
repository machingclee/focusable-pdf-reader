/**
 * Small checks more than one bounded context needs.
 *
 * They are not domain rules: they only prove that a request describes the rows
 * the caller claims it describes. Both reorder use cases need the same one, and
 * neither context should have to import the other's service to get it.
 */

import { ErrorFactory } from "../../common/http.ts";

/**
 * Refuse ids that do not describe exactly the rows the caller loaded: same
 * length, no repeats, same members.
 */
export function assertSameIds(expected: number[], actual: number[], message: string): void {
  if (expected.length !== actual.length || new Set(actual).size !== actual.length) {
    throw ErrorFactory.ofBadRequest(message);
  }
  const wanted = new Set(expected);
  if (actual.some((id) => !wanted.has(id))) throw ErrorFactory.ofBadRequest(message);
}
