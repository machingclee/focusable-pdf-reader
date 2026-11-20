import { describe, expect, test } from "bun:test";
import { configureStore } from "@reduxjs/toolkit";
import {
  MUTATION_TAG_TYPES,
  applyRemoteInvalidation,
  crossWindowSync,
  tagTypesForAction,
} from "../src/store/crossWindowSync";
import type { AppDispatch } from "../src/store/store";

/** The action RTK Query dispatches after a mutation succeeds. */
function fulfilledMutation(endpointName: string) {
  return {
    type: "api/executeMutation/fulfilled",
    payload: { id: 1 },
    meta: {
      arg: { type: "mutation", endpointName, originalArgs: { id: 1 } },
      requestId: "request-1",
      requestStatus: "fulfilled",
    },
  };
}

describe("tagTypesForAction", () => {
  test("reads the endpoint the mutation belongs to", () => {
    expect(tagTypesForAction(fulfilledMutation("updateStrip"))).toEqual(MUTATION_TAG_TYPES.updateStrip);
    expect(tagTypesForAction(fulfilledMutation("deleteFolder"))).toEqual(MUTATION_TAG_TYPES.deleteFolder);
  });

  test("ignores queries, failures and everything else", () => {
    const query = {
      type: "api/executeQuery/fulfilled",
      meta: { arg: { type: "query", endpointName: "listFolders" } },
    };
    const rejected = {
      ...fulfilledMutation("updateStrip"),
      type: "api/executeMutation/rejected",
      meta: { ...fulfilledMutation("updateStrip").meta, requestStatus: "rejected" },
    };
    const pending = { ...fulfilledMutation("updateStrip"), type: "api/executeMutation/pending" };

    for (const action of [
      query,
      rejected,
      pending,
      { type: "api/invalidateTags" },
      { type: "app/setBackend" },
      null,
      undefined,
      "api/executeMutation/fulfilled",
      42,
    ]) {
      expect(tagTypesForAction(action)).toBeNull();
    }
  });

  test("a local-only mutation is not forwarded", () => {
    // The docked column's width is the main window's business.
    expect(tagTypesForAction(fulfilledMutation("setAppState"))).toBeNull();
  });

  test("an endpoint it does not know about is not forwarded", () => {
    expect(tagTypesForAction(fulfilledMutation("somethingNew"))).toBeNull();
  });

  test("only RTK's own action shape counts", () => {
    // Meta present but not a mutation, and a mutation whose arg has no endpoint.
    expect(
      tagTypesForAction({
        type: "api/executeMutation/fulfilled",
        meta: { arg: { type: "query", endpointName: "updateStrip" } },
      }),
    ).toBeNull();
    expect(
      tagTypesForAction({ type: "api/executeMutation/fulfilled", meta: { arg: { type: "mutation" } } }),
    ).toBeNull();
  });
});

describe("crossWindowSync", () => {
  /** The middleware on its own: the real store's `baseApi` middleware would
   *  reject a hand-written action, and this is about the forwarding rule. */
  const storeWithSpy = () => {
    const sent: string[][] = [];
    const store = configureStore({
      reducer: (state = 0) => state,
      middleware: (getDefault) => getDefault().concat(crossWindowSync((types) => sent.push(types))),
    });
    return { sent, store };
  };

  test("forwards the tag types of a fulfilled mutation", () => {
    const { sent, store } = storeWithSpy();
    store.dispatch(fulfilledMutation("reorderStrips") as never);
    expect(sent).toEqual([MUTATION_TAG_TYPES.reorderStrips]);
  });

  test("says nothing for a query, a rejection or a local mutation", () => {
    const { sent, store } = storeWithSpy();
    store.dispatch({ type: "api/executeQuery/fulfilled", meta: { arg: { type: "query", endpointName: "listFolders" } } } as never);
    store.dispatch({ ...fulfilledMutation("updateStrip"), type: "api/executeMutation/rejected" } as never);
    store.dispatch(fulfilledMutation("setAppState") as never);
    expect(sent).toEqual([]);
  });

  test("passes the action through unchanged", () => {
    const { store } = storeWithSpy();
    const action = { type: "app/clearBackend" };
    expect(store.dispatch(action as never)).toBe(action);
  });
});

describe("applyRemoteInvalidation", () => {
  test("dispatches the cache invalidation, once, with the forwarded types", () => {
    const seen: string[] = [];
    const dispatch = ((action: { type: string }) => {
      seen.push(action.type);
      return action;
    }) as unknown as AppDispatch;

    applyRemoteInvalidation(dispatch, ["FocusableStrip", "Folder"]);
    expect(seen).toEqual(["api/invalidateTags"]);
  });

  test("an empty payload is not worth a dispatch", () => {
    let calls = 0;
    const dispatch = (() => {
      calls += 1;
    }) as unknown as AppDispatch;

    applyRemoteInvalidation(dispatch, []);
    expect(calls).toBe(0);
  });
});
