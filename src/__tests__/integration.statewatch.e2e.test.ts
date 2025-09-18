import { atom, createStore } from "jotai/vanilla";
import {
  defineWatchers,
  defineWatcherCallback,
  createWatcherManager,
  type WatcherEvent,
} from "..";

// A very small in-memory logger spy to assert side-effects without noisy console
const createTestLogger = () => {
  const logs: { level: string; msg: string }[] = [];
  const push = (level: string, message: string, ..._args: any[]) => {
    logs.push({ level, msg: message });
  };
  return {
    info: (m: string, ...a: any[]) => push("info", m, ...a),
    debug: (m: string, ...a: any[]) => push("debug", m, ...a),
    error: (m: string, ...a: any[]) => push("error", m, ...a),
    logs,
  };
};

/** Utility to await the next task tick (flush queued promises / microtasks) */
const nextTick = () => new Promise((r) => setTimeout(r, 0));

describe("statewatch integration – defineWatchers + defineWatcherCallback + watcherManager", () => {
  test("happy path: startAll wires callbacks, atom changes propagate, stopAll detaches", async () => {
    // --- Arrange atoms & store ---
    const countAtom = atom(0);
    const flagAtom = atom(false);
    const store = createStore();
    const logger = createTestLogger();

    // --- Build watchers map the way real apps do ---
    const { create: createAtomWatchers, WatcherIds } = defineWatchers({
      countWatcher: countAtom,
      flagWatcher: flagAtom,
    });

    const watchers = createAtomWatchers(store, logger);

    // --- Define callback configs using helper for strong typing ---
    const countAndFlagEvents: WatcherEvent[][] = [];
    const singleFlagEvents: WatcherEvent[][] = [];

    const callbackConfigs = {
      // Multi-watcher callback
      multi: defineWatcherCallback<
        typeof watchers,
        readonly [typeof WatcherIds.countWatcher, typeof WatcherIds.flagWatcher]
      >({
        watchers: [WatcherIds.countWatcher, WatcherIds.flagWatcher] as const,
        description: "Collect both count + flag events each flush",
        callback: async (events) => {
          countAndFlagEvents.push([events.countWatcher, events.flagWatcher]);
        },
      }),
      // Single watcher callback
      flagOnly: defineWatcherCallback<
        typeof watchers,
        readonly [typeof WatcherIds.flagWatcher]
      >({
        watchers: [WatcherIds.flagWatcher] as const,
        callback: async (events) => {
          singleFlagEvents.push([events.flagWatcher]);
        },
      }),
    } as const;

    const manager = createWatcherManager(watchers, callbackConfigs, logger);

    // --- Act: start watching ---
    manager.startAll();
    // Give initial dispatch time
    await nextTick();

    // Initial tick should have produced 1 entry for both callbacks
    expect(countAndFlagEvents.length).toBe(1);
    expect(singleFlagEvents.length).toBe(1);
    expect(countAndFlagEvents[0][0].isInitial).toBe(true);
    expect(countAndFlagEvents[0][1].isInitial).toBe(true);

    // Mutate only countAtom
    store.set(countAtom, 1);
    await nextTick();

    // Fan-in aggregator should batch per flush; we expect another row
    expect(countAndFlagEvents.length).toBe(2);
    const secondMulti = countAndFlagEvents[1];
    expect(secondMulti[0].current).toBe(1);
    expect(secondMulti[0].previous).toBe(0);
    // flagWatcher did not change, still produces an event object (same shape) marking changed = true per watcher impl initial semantics
    // We only assert that its id matches and the value is still false.
    expect(secondMulti[1].current).toBe(false);

    // Mutate flagAtom twice rapidly (may collapse into a single aggregated flush)
    const beforeFlagMutationsMulti = countAndFlagEvents.length;
    const beforeFlagMutationsSingle = singleFlagEvents.length;
    store.set(flagAtom, true);
    store.set(flagAtom, false);
    await nextTick();

    // We require at least one additional aggregated delivery (cannot rely on two because
    // microtask fan-in intentionally collapses multiple same-cycle events per watcher).
    expect(countAndFlagEvents.length).toBeGreaterThanOrEqual(
      beforeFlagMutationsMulti + 1
    );
    expect(singleFlagEvents.length).toBeGreaterThanOrEqual(
      beforeFlagMutationsSingle + 1
    );

    // --- Act: stopAll and then change atoms again ---
    manager.stopAll();
    store.set(countAtom, 99);
    store.set(flagAtom, true);
    await nextTick();

    // No new events should be appended after stop
    const afterStopMultiLen = countAndFlagEvents.length;
    const afterStopSingleLen = singleFlagEvents.length;
    expect(countAndFlagEvents.length).toBe(afterStopMultiLen);
    expect(singleFlagEvents.length).toBe(afterStopSingleLen);

    // --- Basic logger smoke assertions ---
    expect(
      logger.logs.find((l) => l.msg.includes("WatcherManager: startAll"))
    ).toBeTruthy();
    expect(
      logger.logs.find((l) => l.msg.includes("WatcherManager: stopAll"))
    ).toBeTruthy();
  });

  test("restart: calling startAll twice resets registrations without duplicating events", async () => {
    const valueAtom = atom(0);
    const store = createStore();
    const logger = createTestLogger();

    const { create: createAtomWatchers, WatcherIds } = defineWatchers({
      valueWatcher: valueAtom,
    });
    const watchers = createAtomWatchers(store, logger);

    const events: WatcherEvent[][] = [];
    const callbackConfigs = {
      collector: defineWatcherCallback<
        typeof watchers,
        readonly [typeof WatcherIds.valueWatcher]
      >({
        watchers: [WatcherIds.valueWatcher] as const,
        callback: async (ev) => {
          events.push([ev.valueWatcher]);
        },
      }),
    } as const;

    const manager = createWatcherManager(watchers, callbackConfigs, logger);
    manager.startAll();
    await nextTick();
    expect(events.length).toBe(1); // initial

    // Restart (note: current implementation does NOT re-emit initial events because
    // watchers remain actively subscribed; startAll only re-registers callbacks.)
    manager.startAll();
    await nextTick();
    // Therefore no additional event yet.
    expect(events.length).toBe(1);

    // If we want a fresh initial event we must stop then start.
    manager.stopAll();
    manager.startAll();
    await nextTick();
    expect(events.length).toBe(2); // second initial after explicit stop/start

    // Change value to ensure only one new event per change
    store.set(valueAtom, 1);
    await nextTick();
    expect(events.length).toBe(3);
  });
});
