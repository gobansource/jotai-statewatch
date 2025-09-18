import { atom, createStore } from "jotai/vanilla";
import type { Atom } from "jotai/vanilla";

/**
 * Helper that wires a listener to an atom and returns the spy together with the
 * unsubscribe function for completeness (the tests don't need to call it but
 * it's good hygiene).
 */
function subscribeWithSpy<Value>(atomToWatch: Atom<Value>) {
  const store = createStore();
  const spy = jest.fn();
  const unsubscribe = store.sub(atomToWatch, spy);
  return { store, spy, unsubscribe } as const;
}

describe("Jotai store – subscription trigger behaviour (Object.is equality)", () => {
  test("string atom fires only when value changes", () => {
    const strAtom = atom("a");
    const { store, spy } = subscribeWithSpy(strAtom);

    expect(spy).toHaveBeenCalledTimes(0);

    store.set(strAtom, "b"); // different value -> should fire
    expect(spy).toHaveBeenCalledTimes(1);

    store.set(strAtom, "b"); // same value -> no extra fire
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("number atom fires only when value changes", () => {
    const numAtom = atom(1);
    const { store, spy } = subscribeWithSpy(numAtom);

    store.set(numAtom, 2); // diff
    store.set(numAtom, 2); // same

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("boolean atom fires only when value changes", () => {
    const boolAtom = atom(false);
    const { store, spy } = subscribeWithSpy(boolAtom);

    store.set(boolAtom, true); // diff
    store.set(boolAtom, true); // same

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("object atom fires on reference change (Object.is identity)", () => {
    const objAtom = atom({ a: 1 });
    const { store, spy } = subscribeWithSpy(objAtom);

    const sameRef = store.get(objAtom); // grab initial

    store.set(objAtom, sameRef); // same reference – should NOT fire
    expect(spy).toHaveBeenCalledTimes(0);

    store.set(objAtom, { a: 1 }); // new reference – SHOULD fire
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("NaN treated as equal to NaN (no extra fire)", () => {
    const nanAtom = atom(NaN);
    const { store, spy } = subscribeWithSpy(nanAtom);

    store.set(nanAtom, NaN); // NaN vs NaN – Object.is returns true
    expect(spy).toHaveBeenCalledTimes(0);
  });

  // ---------------------------------------------------------------------
  // DERIVED ATOMS
  // ---------------------------------------------------------------------

  test("derived number atom fires only when derived value changes", () => {
    const countAtom = atom(0);
    const doubleAtom = atom((get) => get(countAtom) * 2);

    const { store, spy } = subscribeWithSpy(doubleAtom);

    // baseline – no calls yet
    expect(spy).toHaveBeenCalledTimes(0);

    store.set(countAtom, 1); // double becomes 2 – change
    expect(spy).toHaveBeenCalledTimes(1);

    store.set(countAtom, 1); // same base value – no change in double
    expect(spy).toHaveBeenCalledTimes(1);

    store.set(countAtom, 2); // double becomes 4 – change
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("derived boolean atom only triggers when boolean output flips", () => {
    const countAtom = atom(0);
    const isEvenAtom = atom((get) => get(countAtom) % 2 === 0);

    const { store, spy } = subscribeWithSpy(isEvenAtom);

    // change but parity stays even -> no fire
    store.set(countAtom, 2);
    expect(spy).toHaveBeenCalledTimes(0);

    // parity flips to odd -> fire
    store.set(countAtom, 3);
    expect(spy).toHaveBeenCalledTimes(1);

    // odd -> odd (no flip)
    store.set(countAtom, 5);
    expect(spy).toHaveBeenCalledTimes(1);

    // flips back to even -> fire again
    store.set(countAtom, 6);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------
  // OBJECT ATOM + DERIVED PROPERTY ATOM
  // ---------------------------------------------------------------------

  test("derived property atom ignores unrelated property changes (compare base vs derived)", () => {
    type Payload = { foo: number; bar: number };
    const objAtom = atom<Payload>({ foo: 1, bar: 1 });
    const fooAtom = atom((get) => get(objAtom).foo);

    // manual wiring to observe both atoms with the *same* store instance
    const store = createStore();
    const objSpy = jest.fn();
    const fooSpy = jest.fn();
    store.sub(objAtom, objSpy);
    store.sub(fooAtom, fooSpy);

    // --- change bar only (foo stays 1) ---
    store.set(objAtom, { foo: 1, bar: 2 });
    expect(objSpy).toHaveBeenCalledTimes(1); // base atom changed (new ref)
    expect(fooSpy).toHaveBeenCalledTimes(0); // derived value unchanged

    // --- change foo as well ---
    store.set(objAtom, { foo: 2, bar: 2 });
    expect(objSpy).toHaveBeenCalledTimes(2); // second base change
    expect(fooSpy).toHaveBeenCalledTimes(1); // derived now fires
  });

  test("same reference mutation does not trigger listeners (anti-pattern)", () => {
    type Payload = { foo: number; bar: number };
    const objAtom = atom<Payload>({ foo: 1, bar: 1 });
    const fooAtom = atom((get) => get(objAtom).foo);

    const { store, spy } = subscribeWithSpy(fooAtom);

    const current = store.get(objAtom);
    current.foo = 99; // mutate in place – BAD PRACTICE!
    store.set(objAtom, current);

    // Because reference is identical, Object.is returns true – no notifications
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
