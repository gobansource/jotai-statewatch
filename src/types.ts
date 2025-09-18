import type { Atom } from "jotai";

/**
 * Minimal logger interface expected by the library. Consumers can pass in any
 * logger implementation (winston, console, custom) as long as it exposes
 * debug/error methods with the same signature.
 */
export interface LoggerLike {
  info: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

/**
 * Store interface – subset of Jotai store that statewatch depends on.
 * We intentionally avoid importing createStore at runtime; we only need the
 * type definition. Jotai exports the concrete type from the vanilla package.
 */
export type StoreLike = ReturnType<typeof import("jotai").createStore>;

/** Generic map of watcher instances keyed by string identifiers */
export type WatchersMap = Record<string, SingleAtomWatcher<any>>;

/**
 * Options for creating an interval-aware callback.
 */
export type IntervalCallbackOptions<
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
> = {
  /** Function deciding whether the interval should be active. */
  condition: (events: EventsFor<M, KS>) => Promise<boolean>;
  /**
   * Action executed immediately (after condition passes) and on each interval tick.
   */
  action: () => Promise<void>;
  /** Interval duration in milliseconds */
  intervalMs: number;
  /** Logger implementation */
  logger: LoggerLike;
  /** Whether to run the action immediately on interval setup, default is true, only specify this if you want to delay the first run */
  runOnSetup?: boolean;
};

export type IntervalCallbackResult<
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
> = {
  /** The callback wired into an atom watcher */
  callback: (events: EventsFor<M, KS>) => Promise<void>;
  /** Cleanup function to clear the interval when deregistering */
  cleanup: () => void;
};

/** Payload sent from each SingleAtomWatcher invocation */
export interface WatcherEvent<T = unknown> {
  /** Identifier of the watcher that produced this event */
  id: string;
  /** Current value of the atom when the event was generated */
  current: T;
  /** Previous value if available (undefined on the very first event) */
  previous?: T;
  /** True when the event originates from the watcher's manual initial kick */
  isInitial: boolean;
  /** True when the atom value changed since the last flush */
  isChanged: boolean;
}

/** Callback type used by consumers of the watcher aggregation layer */
export type AtomWatcherCallback = (
  events: WatcherEvent[]
) => void | Promise<void>;

/** Internal callback type for a single-atom watcher */
export type SingleAtomCallback<T = unknown> = (
  event: WatcherEvent<T>
) => void | Promise<void>;

/**
 * Interface exposed by each watcher instance.
 */
export interface SingleAtomWatcher<T> {
  /** Register a callback with a caller-supplied identifier */
  addCallback: (callback: SingleAtomCallback<T>, id: string) => void;
  /** Remove a callback by id */
  removeCallback: (id: string) => boolean;
  /** Remove all callbacks */
  removeAllCallbacks: () => void;
  /** Begin listening to atom changes */
  startWatching: () => void;
  /** Stop listening */
  stopWatching: () => void;
  /** Current value of the atom */
  getCurrentValue: () => T;
}

// Helper type: extracts the runtime value type from a SingleAtomWatcher
export type AtomValueFromWatcher<W> = W extends SingleAtomWatcher<infer V>
  ? V
  : never;

/**
 * Maps a tuple/array of watcher IDs to an object shape whose keys are those IDs
 * and values are the WatcherEvent payload for the corresponding atom.
 *
 * If a given watcher did not emit an event in the current flush cycle, its
 * property will be undefined so consumers can easily test for presence.
 */
export type EventsFor<
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
> = {
  [K in KS[number]]: WatcherEvent<AtomValueFromWatcher<M[K]>>;
};

/** Convenience alias for the events object passed to callbacks */
export type WatcherEvents<
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
> = EventsFor<M, KS>;

/** The strongly typed callback signature */
export type WatcherCallback<
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
> = (events: WatcherEvents<M, KS>) => void | Promise<void>;

/** Generic callback configuration. The `watchers` array decides both which
 * SingleAtomWatcher instances this callback listens to *and* the compile-time
 * shape of the `events` parameter passed to the callback.
 */
export type WatcherCallbackConfig<
  M extends WatchersMap = WatchersMap,
  KS extends readonly (keyof M)[] = (keyof M)[]
> = {
  watchers: ReadonlyArray<keyof M>;
  callback: (events: EventsFor<M, KS>) => void | Promise<void>;
  setup?: () => void;
  teardown?: () => void;
  description?: string;
};

export interface WatcherManager {
  startAll: () => Promise<void> | void;
  stopAll: () => Promise<void> | void;
}

// Helper type: configuration of a watcher
export type WatcherConfig<M extends WatchersMap = WatchersMap> = {
  id: keyof M;
  atom: Atom<unknown>;
  description?: string;
};

// Helper alias: a dictionary of callback configs keyed by a unique string
export type CallbackConfigs<M extends WatchersMap = WatchersMap> = Record<
  string,
  WatcherCallbackConfig<M>
>;
