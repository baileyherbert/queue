import { vi } from 'vitest';

/**
 * A promise along with functions to settle it from the outside.
 */
export interface Deferred<T = void> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

/**
 * Creates a promise that can be resolved or rejected manually.
 */
export function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

/**
 * A live view of a promise's settlement state.
 */
export interface Tracked<T> {
	status: 'pending' | 'fulfilled' | 'rejected';
	value?: T;
	reason?: unknown;
}

/**
 * Tracks the state of a promise so tests can assert on it synchronously without awaiting it, which keeps a promise
 * that never settles from hanging the test.
 */
export function track<T>(promise: Promise<T>): Tracked<T> {
	const state: Tracked<T> = { status: 'pending' };

	promise.then(
		value => {
			state.status = 'fulfilled';
			state.value = value;
		},
		reason => {
			state.status = 'rejected';
			state.reason = reason;
		}
	);

	return state;
}

/**
 * Lets pending microtasks and zero-delay timers run, such as the queue's asynchronous ticks. Requires fake timers.
 */
export async function flush(): Promise<void> {
	await vi.advanceTimersByTimeAsync(10);
}
