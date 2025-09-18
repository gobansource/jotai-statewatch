import { registerCallbacks } from "../registerCallbacks";
import { createFanInAggregator } from "../createFanInAggregator";
import type {
  SingleAtomWatcher,
  WatcherCallbackConfig,
  WatcherEvent,
  WatchersMap,
} from "../types";

// We'll spy on createFanInAggregator to ensure it's used correctly and to gain
// access to the fanIn callback so we can simulate incoming watcher events.
jest.mock("../createFanInAggregator", () => {
  return {
    createFanInAggregator: jest.fn((cfgKey: string, cfg: any) => {
      // Provide a fanIn implementation that immediately queues events into an
      // array so tests can assert flush/cleanup logic deterministically. We
      // keep a simple queued map and a manual flush method invoked via dispose.
      const received: WatcherEvent[] = [];
      const fanIn = (ev: WatcherEvent) => {
        received.push(ev);
      };
      const dispose = () => {
        // on disposal we invoke the user callback synchronously with an object
        // that mirrors createFanInAggregator final shape (all watched keys).
        const eventsObject: Record<string, WatcherEvent> = {};
        (cfg.watchers as (keyof any)[]).forEach((k: any) => {
          // find last event for that id if any
          const found = [...received].reverse().find((e) => e.id === k);
          if (found) {
            eventsObject[k] = found;
          } else {
            eventsObject[k] = {
              id: String(k),
              current: undefined,
              previous: undefined,
              isInitial: false,
              isChanged: false,
            };
          }
        });
        received.length = 0; // clear
        cfg.callback(eventsObject);
      };
      return { fanIn, dispose };
    }),
  };
});

const loggerStub = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

function makeWatcher<T>(initial: T): SingleAtomWatcher<T> {
  let callbacks: Record<string, (e: WatcherEvent<T>) => any> = {};
  let current = initial;
  return {
    addCallback: jest.fn((cb, id) => {
      callbacks[id] = cb as any;
    }),
    removeCallback: jest.fn((id: string) => {
      if (callbacks[id]) {
        delete callbacks[id];
        return true;
      }
      return false;
    }),
    removeAllCallbacks: jest.fn(() => {
      callbacks = {};
    }),
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    getCurrentValue: () => current,
  } as SingleAtomWatcher<T>;
}

describe("registerCallbacks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("registers callbacks with generated ids and calls setup", () => {
    const watchers = {
      a: makeWatcher(1),
      b: makeWatcher("x"),
    } as const;

    type M = typeof watchers;
    const cb = jest.fn();
    const setup = jest.fn();
    const teardown = jest.fn();

    const cfg: Record<string, WatcherCallbackConfig<M>> = {
      onChange: {
        watchers: ["a", "b"] as ReadonlyArray<keyof M>,
        callback: cb as any,
        setup,
        teardown,
      },
    };

    const cleanup = registerCallbacks(
      watchers as unknown as WatchersMap,
      cfg as any,
      loggerStub
    );

    // Correct number of registrations (two watcher keys)
    expect(watchers.a.addCallback).toHaveBeenCalledTimes(1);
    expect(watchers.b.addCallback).toHaveBeenCalledTimes(1);

    // verify ids built as `${callbackName}_${key}`
    expect((watchers.a.addCallback as jest.Mock).mock.calls[0][1]).toBe(
      "onChange_a"
    );
    expect((watchers.b.addCallback as jest.Mock).mock.calls[0][1]).toBe(
      "onChange_b"
    );

    expect(setup).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(0);

    cleanup();

    // teardown invoked on cleanup
    expect(teardown).toHaveBeenCalledTimes(1);
    // callbacks removed with same ids
    expect(watchers.a.removeCallback).toHaveBeenCalledWith("onChange_a");
    expect(watchers.b.removeCallback).toHaveBeenCalledWith("onChange_b");
  });

  test("disposes aggregators before teardown so final batch delivered", () => {
    const watchers = { a: makeWatcher(0) } as const;
    type M = typeof watchers;

    const delivered: any[] = [];
    const cb = jest.fn((eventsObj) => delivered.push(eventsObj));
    const teardown = jest.fn();

    const cfg: Record<string, WatcherCallbackConfig<M>> = {
      metrics: {
        watchers: ["a"] as ReadonlyArray<keyof M>,
        callback: cb as any,
        teardown,
      },
    };

    const cleanup = registerCallbacks(
      watchers as unknown as WatchersMap,
      cfg as any,
      loggerStub
    );

    // capture fanIn passed to addCallback
    const fanIn = (watchers.a.addCallback as jest.Mock).mock.calls[0][0] as (
      e: WatcherEvent
    ) => void;
    // simulate an event prior to cleanup
    fanIn({
      id: "a",
      current: 5,
      previous: 4,
      isInitial: false,
      isChanged: true,
    });

    // No callback yet because we flush only on dispose
    expect(cb).not.toHaveBeenCalled();

    cleanup();

    // After cleanup aggregator dispose should have flushed events once
    expect(cb).toHaveBeenCalledTimes(1);
    expect(delivered[0].a.current).toBe(5);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  test("supports multiple callback configs independently", () => {
    const watchers = { a: makeWatcher(1) } as const;
    type M = typeof watchers;

    const cb1 = jest.fn();
    const cb2 = jest.fn();

    const cfg: Record<string, WatcherCallbackConfig<M>> = {
      first: {
        watchers: ["a"] as ReadonlyArray<keyof M>,
        callback: cb1 as any,
      },
      second: {
        watchers: ["a"] as ReadonlyArray<keyof M>,
        callback: cb2 as any,
      },
    };

    const cleanup = registerCallbacks(
      watchers as unknown as WatchersMap,
      cfg as any,
      loggerStub
    );

    expect(createFanInAggregator).toHaveBeenCalledTimes(2);
    // each aggregator registered a fanIn
    expect(watchers.a.addCallback).toHaveBeenCalledTimes(2);

    cleanup();

    // both callbacks removed
    expect(watchers.a.removeCallback).toHaveBeenCalledTimes(2);
  });
});
