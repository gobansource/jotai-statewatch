import { createIntervalCallback } from "../intervalCallback";
import type {
  IntervalCallbackOptions,
  WatchersMap,
  WatcherEvent,
} from "../types";

// We will use fake timers to control setInterval / clearInterval behaviour
// across the tests.

const loggerStub = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Helper to build a minimal events object matching the generic constraints.
// For the purposes of these tests, we only care that the shape matches, not
// the runtime semantics of watchers.
function buildEvents(ids: readonly string[]): Record<string, WatcherEvent> {
  return ids.reduce<Record<string, WatcherEvent>>((acc, id) => {
    acc[id] = {
      id,
      current: undefined,
      previous: undefined,
      isInitial: false,
      isChanged: true,
    };
    return acc;
  }, {});
}

describe("createIntervalCallback", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const ids = ["a", "b"] as const;
  type M = WatchersMap; // not used directly, but keeps generics readable

  const make = (
    overrides: Partial<IntervalCallbackOptions<M, typeof ids>> = {},
  ) => {
    const onTick = jest.fn(async () => {
      /* no-op */
    });
    const whenTrue = jest.fn(async () => {
      /* no-op */
    });
    const whenFalse = jest.fn(async () => {
      /* no-op */
    });
    const condition = jest.fn(async () => true);

    const options: IntervalCallbackOptions<M, typeof ids> = {
      condition: overrides.condition ?? condition,
      onTick: overrides.onTick ?? onTick,
      whenTrue: overrides.whenTrue ?? whenTrue,
      whenFalse: overrides.whenFalse ?? whenFalse,
      intervalMs: overrides.intervalMs ?? 5000,
      logger: loggerStub,
    } as any; // generics around WatchersMap are not important here

    const result = createIntervalCallback(options);
    return {
      ...result,
      options,
      onTick,
      whenTrue,
      whenFalse,
      condition,
    } as const;
  };

  test("calls whenTrue on first evaluation where condition is true", async () => {
    const { callback, whenTrue, onTick } = make();
    const events = buildEvents(ids) as any;
    await callback(events);

    expect(whenTrue).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled(); // no immediate tick

    // advance time to trigger one interval tick
    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  test("calls whenTrue on every evaluation where condition is true", async () => {
    const { callback, whenTrue } = make();
    const events = buildEvents(ids) as any;
    await callback(events);
    await callback(events);

    expect(whenTrue).toHaveBeenCalledTimes(2);
  });

  test("calls whenFalse when condition becomes false and clears interval", async () => {
    const condition = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const { callback, whenFalse, onTick } = make({ condition });
    const events = buildEvents(ids) as any;
    await callback(events); // true
    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    await callback(events); // false
    expect(whenFalse).toHaveBeenCalledTimes(1);

    // no more ticks
    const ticksAfterClear = onTick.mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(ticksAfterClear);
  });

  test("calls whenFalse on every evaluation where condition is false", async () => {
    const condition = jest.fn().mockResolvedValue(false);
    const { callback, whenFalse } = make({ condition });
    const events = buildEvents(ids) as any;
    await callback(events);
    await callback(events);

    expect(whenFalse).toHaveBeenCalledTimes(2);
  });

  test("ticks on interval while condition stays true", async () => {
    const { callback, onTick } = make();
    const events = buildEvents(ids) as any;
    await callback(events);

    jest.advanceTimersByTime(15000); // 3 ticks
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  test("restarts interval without duplicating when condition stays true across callbacks", async () => {
    const { callback, onTick } = make();
    const events = buildEvents(ids) as any;

    await callback(events); // start interval
    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    await callback(events); // condition still true — restart interval
    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2); // one more tick, not duplicated
  });

  test("logs error but continues ticking when onTick rejects", async () => {
    const failingTick = jest.fn(async () => {
      throw new Error("boom");
    });
    const { callback } = make({ onTick: failingTick });
    const events = buildEvents(ids) as any;

    await callback(events);

    jest.advanceTimersByTime(5000);
    // Flush the async onTick rejection handler
    await Promise.resolve();
    expect(failingTick).toHaveBeenCalledTimes(1);
    expect(loggerStub.error).toHaveBeenCalledWith(
      expect.stringContaining("Error executing onTick"),
      expect.any(Error),
    );

    // Next tick should also attempt again
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(failingTick).toHaveBeenCalledTimes(2);
  });

  test("cleanup stops further ticks", async () => {
    const { callback, cleanup, onTick } = make();
    const events = buildEvents(ids) as any;
    await callback(events);

    jest.advanceTimersByTime(5000); // one tick
    expect(onTick).toHaveBeenCalledTimes(1);

    cleanup(); // clear interval
    const callsAtCleanup = onTick.mock.calls.length;

    jest.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(callsAtCleanup); // no new calls
  });

  test("full lifecycle: true → ticks → false → true again", async () => {
    const condition = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const { callback, whenTrue, whenFalse, onTick } = make({
      condition,
    });
    const events = buildEvents(ids) as any;

    await callback(events); // true
    expect(whenTrue).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    await callback(events); // false
    expect(whenFalse).toHaveBeenCalledTimes(1);

    await callback(events); // true again
    expect(whenTrue).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});
