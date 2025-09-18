import type { Atom } from "jotai";

import { createSingleAtomWatcher } from "./singleAtomWatcher";
import type { StoreLike, LoggerLike, SingleAtomWatcher } from "./types";

/**
 * Extracts the runtime value type from a Jotai Atom.
 */
export type AtomValue<A extends Atom<unknown>> = A extends Atom<infer T>
  ? T
  : never;

/**
 * Given a compile-time map of atoms, produces the strongly-typed map of
 * SingleAtomWatcher instances.
 */
export type WatchersFromMap<M extends Record<string, Atom<unknown>>> = {
  [K in keyof M]: SingleAtomWatcher<AtomValue<M[K]>>;
};

/**
 * Creates watchers for every atom in the provided map.
 *
 * Example usage:
 * ```ts
 * const atomMap = { counter: counterAtom } as const;
 * const watchers = createWatchersFromMap(atomMap, store, logger);
 * ```
 */
export const createWatchersFromMap = <M extends Record<string, Atom<unknown>>>(
  atomMap: M,
  store: StoreLike,
  logger: LoggerLike
): WatchersFromMap<M> => {
  return Object.fromEntries(
    (Object.entries(atomMap) as Array<[keyof M, Atom<unknown>]>).map(
      ([id, atom]) => [
        id,
        createSingleAtomWatcher(store, logger, atom, id as string),
      ]
    )
  ) as WatchersFromMap<M>;
};
