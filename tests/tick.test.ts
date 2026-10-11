import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultYieldInterval, scheduleTick } from '../src/tick';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('scheduleTick()', () => {
	it('uses setImmediate when available', () => {
		const setImmediate = vi.fn();
		const callback = vi.fn();
		vi.stubGlobal('setImmediate', setImmediate);

		scheduleTick(callback);

		expect(setImmediate).toHaveBeenCalledExactlyOnceWith(callback);
	});

	it('falls back to MessageChannel when setImmediate is unavailable', async () => {
		const setTimeout = vi.spyOn(globalThis, 'setTimeout');
		vi.stubGlobal('setImmediate', undefined);

		await new Promise<void>(resolve => scheduleTick(resolve));

		expect(setTimeout).not.toHaveBeenCalled();
	});

	it('falls back to setTimeout when setImmediate and MessageChannel are unavailable', () => {
		vi.useFakeTimers();
		vi.stubGlobal('setImmediate', undefined);
		vi.stubGlobal('MessageChannel', undefined);
		const callback = vi.fn();

		scheduleTick(callback);
		expect(callback).not.toHaveBeenCalled();

		vi.advanceTimersByTime(0);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it.each([
		['setImmediate', () => {}],
		['MessageChannel', () => vi.stubGlobal('setImmediate', undefined)]
	])('runs after pending promises have settled (%s)', async (_name, setup) => {
		setup();
		const order: string[] = [];

		await new Promise<void>(resolve => {
			scheduleTick(() => {
				order.push('tick');
				resolve();
			});

			Promise.resolve().then(() => order.push('promise'));
		});

		expect(order).toEqual(['promise', 'tick']);
	});
});

describe('getDefaultYieldInterval()', () => {
	it('returns 1 when setImmediate is available', () => {
		expect(getDefaultYieldInterval()).toBe(1);
	});

	it('returns 5 when setImmediate is unavailable', () => {
		vi.stubGlobal('setImmediate', undefined);

		expect(getDefaultYieldInterval()).toBe(5);
	});
});
