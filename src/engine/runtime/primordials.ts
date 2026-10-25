/**
 * Built-ins captured before user code runs, so programs that patch prototypes (Array.prototype.push = …)
 * cannot break the tracer. Only what the runtime's hot paths need.
 */
const uncurry = <A extends unknown[], R>(fn: (...args: A) => R) =>
  (self: unknown, ...args: A): R => Reflect.apply(fn, self, args) as R;

const AP = Array.prototype;
export const ArrayProto = AP;
export const arrayPush = uncurry(AP.push as (...items: unknown[]) => number);
export const arrayPop = uncurry(AP.pop as () => unknown);
export const arraySlice = uncurry(AP.slice as (start?: number, end?: number) => unknown[]);
export const isArray = Array.isArray;

export const MapProto = Map.prototype;
export const SetProto = Set.prototype;
export const mapGet = uncurry(MapProto.get as (k: unknown) => unknown);
export const mapSet = uncurry(MapProto.set as (k: unknown, v: unknown) => Map<unknown, unknown>);
export const mapHas = uncurry(MapProto.has as (k: unknown) => boolean);
export const mapDelete = uncurry(MapProto.delete as (k: unknown) => boolean);
export const mapClear = uncurry(MapProto.clear as () => void);
export const mapEntries = uncurry(MapProto.entries as () => IterableIterator<[unknown, unknown]>);
export const mapForEach = uncurry(MapProto.forEach as (cb: (v: unknown, k: unknown) => void) => void);
export const mapSize = (m: Map<unknown, unknown>): number => Reflect.get(MapProto, 'size', m) as number;
export const setAdd = uncurry(SetProto.add as (v: unknown) => Set<unknown>);
export const setHas = uncurry(SetProto.has as (v: unknown) => boolean);
export const setDelete = uncurry(SetProto.delete as (v: unknown) => boolean);
export const setClear = uncurry(SetProto.clear as () => void);
export const setValues = uncurry(SetProto.values as () => IterableIterator<unknown>);
export const setForEach = uncurry(SetProto.forEach as (cb: (v: unknown) => void) => void);
export const setSize = (s: Set<unknown>): number => Reflect.get(SetProto, 'size', s) as number;
export const iterNext = <T>(it: Iterator<T>): IteratorResult<T> => Reflect.apply(it.next, it, []) as IteratorResult<T>;

export const WeakMapCtor = WeakMap;
export const WeakSetCtor = WeakSet;
export const MapCtor = Map;
export const SetCtor = Set;
export const ProxyCtor = Proxy;
export const ObjectProto = Object.prototype;
export const getPrototypeOf = Object.getPrototypeOf;
export const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
export const objectKeys = Object.keys;
export const isExtensible = Object.isExtensible;
export const hasOwn = (o: object, k: PropertyKey): boolean => Reflect.apply(ObjectProto.hasOwnProperty, o, [k]) as boolean;
export const isView = ArrayBuffer.isView;
export const DateCtor = Date;
export const RegExpCtor = RegExp;
export const ErrorCtor = Error;
export const PromiseCtor = Promise;
export const DataViewCtor = DataView;
export const numberIsNaN = Number.isNaN;
export const objectIs = Object.is;
export const stringSlice = uncurry(String.prototype.slice as (s?: number, e?: number) => string);
export const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now.bind(performance)
    : Date.now;
export const realStructuredClone: (<T>(v: T) => T) | undefined =
  typeof structuredClone === 'function' ? structuredClone : undefined;
