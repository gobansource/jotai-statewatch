import { createFanInAggregator } from "../createFanInAggregator";
import type {
  EventsFor,
  SingleAtomWatcher,
  WatcherCallbackConfig,
  WatcherEvent,
  WatchersMap,
} from "../types";

// Logger stub reused across tests
const loggerStub = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Utility mirroring existing tests: flush macrotask so that queued microtasks run
const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r));

// Build minimal watcher stub – only getCurrentValue is consulted by the aggregator.
function makeWatcher<T>(getter: () => T): SingleAtomWatcher<T> {
  return {
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
    removeAllCallbacks: jest.fn(),
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    getCurrentValue: getter,
  } as SingleAtomWatcher<T>;
}

describe("createFanInAggregator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  type MakeEnvResult = {
    watchers: { a: SingleAtomWatcher<number>; b: SingleAtomWatcher<string> };
    cfg: WatcherCallbackConfig<any> & {
      watchers: readonly (keyof any)[];
      callback: jest.Mock<any, any>;
    };
    fanIn: (event: WatcherEvent) => void | Promise<void>;
    dispose: () => void;
  };

  function makeEnv(): MakeEnvResult {
    let currentA = 0;
    let currentB = "x";

    const watchers = {
      a: makeWatcher(() => currentA),
      b: makeWatcher(() => currentB),
    } as const;

    type M = typeof watchers;
    const keys = ["a", "b"] as const;

    const callback = jest.fn<
      void | Promise<void>,
      [EventsFor<M, typeof keys>]
    >();

    const cfg: WatcherCallbackConfig<M, typeof keys> = {
      watchers: keys as unknown as ReadonlyArray<keyof M>,
      callback: callback as any,
    };

    const { fanIn, dispose } = createFanInAggregator(
      "testCfg",
      cfg as any,
      watchers as unknown as WatchersMap,
      loggerStub
    );

    return { watchers: watchers as any, cfg: cfg as any, fanIn, dispose };
  }

  test("aggregates multiple real events in one microtask", async () => {
    const { fanIn, cfg } = makeEnv();

    const evA: WatcherEvent = {
      id: "a",
      current: 1,
      previous: 0,
      isInitial: false,
      isChanged: true,
    };
    const evB: WatcherEvent = {
      id: "b",
      current: "y",
      previous: "x",
      isInitial: true,
      isChanged: true,
    };

    fanIn(evA);
    fanIn(evB);
    await flushMicrotasks();

    expect(cfg.callback).toHaveBeenCalledTimes(1);
    const eventsObj = cfg.callback.mock.calls[0][0];
    expect(eventsObj.a).toEqual(evA);
    expect(eventsObj.b).toEqual(evB);
  });

  test("creates synthetic noop events for non-emitting watchers & preserves previous across cycles", async () => {
    const { fanIn, cfg, watchers } = makeEnv();

    // First cycle: only 'a' emits; 'b' synthetic should have previous=undefined
    fanIn({
      id: "a",
      current: 10,
      previous: 0,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();

    expect(cfg.callback).toHaveBeenCalledTimes(1);
    let eventsObj = cfg.callback.mock.calls[0][0];
    expect(eventsObj.a.current).toBe(10);
    expect(eventsObj.b.id).toBe("b");
    expect(eventsObj.b.isChanged).toBe(false);
    expect(eventsObj.b.isInitial).toBe(false);
    expect(eventsObj.b.previous).toBeUndefined();

    // mutate underlying watcher 'b' value to observe previous propagation – always return new value now
    (watchers as any).b.getCurrentValue = () => "z";

    // Second cycle: again only 'a' emits -> synthetic 'b' keeps current from overridden getter (may still be old if getter evaluated after override). We only assert previous.
    fanIn({
      id: "a",
      current: 11,
      previous: 10,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();

    expect(cfg.callback).toHaveBeenCalledTimes(2);
    eventsObj = cfg.callback.mock.calls[1][0];
    expect(eventsObj.a.current).toBe(11);
    // previous must reference first synthetic current ("x")
    expect(eventsObj.b.previous).toBe("x");

    // Third cycle to confirm new current value now visible
    fanIn({
      id: "a",
      current: 12,
      previous: 11,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();
    expect(cfg.callback).toHaveBeenCalledTimes(3);
    eventsObj = cfg.callback.mock.calls[2][0];
    expect(eventsObj.b.current).toBe("z");
  });

  test("dedupes multiple events for same watcher within a microtask (last wins)", async () => {
    const { fanIn, cfg } = makeEnv();

    fanIn({
      id: "a",
      current: 1,
      previous: 0,
      isInitial: false,
      isChanged: true,
    });
    fanIn({
      id: "a",
      current: 2,
      previous: 1,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();

    expect(cfg.callback).toHaveBeenCalledTimes(1);
    const eventsObj = cfg.callback.mock.calls[0][0];
    expect(eventsObj.a.current).toBe(2);
    expect(eventsObj.a.previous).toBe(1);
  });

  test("dispose triggers immediate flush plus scheduled microtask synthetic flush", async () => {
    const { fanIn, cfg, dispose } = makeEnv();

    fanIn({
      id: "a",
      current: 5,
      previous: 4,
      isInitial: false,
      isChanged: true,
    });

    // Instead of waiting for microtask, call dispose which should force flush
    dispose();
    // First flush (forced) should have happened
    expect(cfg.callback).toHaveBeenCalledTimes(1);
    const first = cfg.callback.mock.calls[0][0];
    expect(first.a.current).toBe(5);
    // Microtask still runs queued flush (now empty -> all synthetic)
    await flushMicrotasks();
    expect(cfg.callback).toHaveBeenCalledTimes(2);
    const second = cfg.callback.mock.calls[1][0];
    expect(second.a.isChanged).toBe(false);
    expect(second.b.isChanged).toBe(false);
  });

  test("logs error when user callback throws but does not rethrow", async () => {
    // Custom env so we can inject a throwing callback
    let currentA = 1;
    let currentB = "x";
    const watchers = {
      a: makeWatcher(() => currentA),
      b: makeWatcher(() => currentB),
    } as const;
    type M = typeof watchers;
    const keys = ["a", "b"] as const;
    // Use async function that rejects to trigger error path without synchronous throw escaping Promise.resolve
    const throwing = jest.fn(async () => {
      throw new Error("User boom");
    });
    const cfg: WatcherCallbackConfig<M, typeof keys> = {
      watchers: keys as unknown as ReadonlyArray<keyof M>,
      callback: throwing as any,
    };
    const { fanIn } = createFanInAggregator(
      "errCfg",
      cfg as any,
      watchers as unknown as WatchersMap,
      loggerStub
    );

    fanIn({
      id: "a",
      current: 2,
      previous: 1,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();
    // Give any Promise rejection chain a chance to invoke catch
    await flushMicrotasks();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(loggerStub.error).toHaveBeenCalledWith(
      expect.stringContaining("Error executing user callback"),
      expect.any(Error)
    );
  });

  test("synthetic event previous derives from last real event value", async () => {
    const { fanIn, cfg } = makeEnv();

    // Cycle 1: real event for 'b' captured
    fanIn({
      id: "b",
      current: "first",
      previous: undefined,
      isInitial: true,
      isChanged: true,
    });
    await flushMicrotasks();
    expect(cfg.callback).toHaveBeenCalledTimes(1);
    let eventsObj = cfg.callback.mock.calls[0][0];
    expect(eventsObj.b.current).toBe("first");

    // Cycle 2: only 'a' real, so 'b' synthetic previous should equal last real current
    fanIn({
      id: "a",
      current: 99,
      previous: 98,
      isInitial: false,
      isChanged: true,
    });
    await flushMicrotasks();
    expect(cfg.callback).toHaveBeenCalledTimes(2);
    eventsObj = cfg.callback.mock.calls[1][0];
    expect(eventsObj.b.previous).toBe("first");
  });
});
