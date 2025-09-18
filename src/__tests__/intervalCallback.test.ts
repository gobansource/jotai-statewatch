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
    overrides: Partial<IntervalCallbackOptions<M, typeof ids>> = {}
  ) => {
    const action = jest.fn(async () => {
      /* no-op */
    });
    const condition = jest.fn(async () => true);

    const options: IntervalCallbackOptions<M, typeof ids> = {
      condition: overrides.condition ?? condition,
      action: overrides.action ?? action,
      intervalMs: overrides.intervalMs ?? 5000,
      logger: loggerStub,
      runOnSetup: overrides.runOnSetup,
    } as any; // generics around WatchersMap are not important here

    const result = createIntervalCallback(options);
    return { ...result, options, action, condition } as const;
  };

  test("runs action immediately on setup when condition passes (default runOnSetup=true)", async () => {
    const { callback, action, condition } = make();
    const events = buildEvents(ids) as any;
    await callback(events);

    expect(condition).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1); // immediate run

    // advance time to trigger one interval tick
    jest.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(2);
  });

  test("does not run immediate action when runOnSetup=false but schedules future ticks", async () => {
    const { callback, action } = make({ runOnSetup: false });
    const events = buildEvents(ids) as any;
    await callback(events);

    expect(action).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(1); // first tick only after interval
  });

  test("clears existing interval when condition becomes false", async () => {
    const condition = jest
      .fn()
      // first invocation true -> sets interval
      .mockResolvedValueOnce(true)
      // second invocation false -> clears interval
      .mockResolvedValueOnce(false);

    const { callback, action } = make({ condition });
    const events = buildEvents(ids) as any;
    await callback(events); // sets up interval + immediate action
    expect(action).toHaveBeenCalledTimes(1);

    // Trigger some ticks then toggle condition off
    jest.advanceTimersByTime(10000); // 2 ticks
    expect(action).toHaveBeenCalledTimes(3);

    await callback(events); // condition now false -> interval cleared
    const actionCallsAfterClear = action.mock.calls.length;

    jest.advanceTimersByTime(10000); // would have produced 2 more ticks if active
    expect(action).toHaveBeenCalledTimes(actionCallsAfterClear); // no new calls
  });

  test("re-initialises (restarts) interval without duplicating when condition stays true", async () => {
    const { callback, action, condition } = make();
    const events = buildEvents(ids) as any;

    await callback(events); // start interval
    jest.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(2);

    // Calling callback again while condition true should clear & re-create one interval only
    await callback(events);
    jest.advanceTimersByTime(5000);

    // Expected calls: 1 immediate + 1 first tick + 1 immediate after restart + 1 tick after restart
    expect(action).toHaveBeenCalledTimes(4);
    expect(condition).toHaveBeenCalledTimes(2);
  });

  test("logs error but continues ticking when action rejects", async () => {
    const failingAction = jest.fn(async () => {
      throw new Error("boom");
    });
    const { callback } = make({ action: failingAction });
    const events = buildEvents(ids) as any;

    await callback(events); // immediate attempt -> logs error
    expect(loggerStub.error).toHaveBeenCalledWith(
      expect.stringContaining("Error executing interval action"),
      expect.any(Error)
    );

    // Next tick should also attempt again
    jest.advanceTimersByTime(5000);
    expect(failingAction).toHaveBeenCalledTimes(2);
  });

  test("cleanup stops further ticks", async () => {
    const { callback, cleanup, action } = make();
    const events = buildEvents(ids) as any;
    await callback(events);

    jest.advanceTimersByTime(5000); // one tick
    expect(action).toHaveBeenCalledTimes(2);

    cleanup(); // clear interval
    const callsAtCleanup = action.mock.calls.length;

    jest.advanceTimersByTime(10000);
    expect(action).toHaveBeenCalledTimes(callsAtCleanup); // no new calls
  });
});
