import { describe, expect, it, vi } from 'vitest';
import { YieldClock } from '../src/yield';

/**
 * Creates a yield clock with a manual clock, and a helper to finish a task that took the given time.
 */
function createClock() {
	const time = { value: 0 };
	const now = vi.fn(() => time.value);
	const clock = new YieldClock(now);

	clock.reset();
	now.mockClear();

	return {
		clock,
		now,
		finishTask(ms: number, interval = 1) {
			time.value += ms;
			return clock.shouldYield(interval);
		}
	};
}

describe('YieldClock', () => {
	it('yields once the interval has elapsed since the slice started', () => {
		const { finishTask } = createClock();

		expect(finishTask(0.4, 1)).toBe(false);
		expect(finishTask(0.4, 1)).toBe(false);
		expect(finishTask(0.4, 1)).toBe(true);
	});

	it('checks the clock after every task to begin with, so a slow first task yields immediately', () => {
		const { finishTask, now } = createClock();

		expect(finishTask(50)).toBe(true);
		expect(now).toHaveBeenCalledTimes(1);
	});

	it('checks the clock every 8 tasks once 8 tasks in a row are fast', () => {
		const { finishTask, now } = createClock();

		for (let i = 0; i < 8; i++) {
			finishTask(0.01);
		}

		expect(now).toHaveBeenCalledTimes(8);

		for (let i = 0; i < 7; i++) {
			finishTask(0.01);
		}

		expect(now).toHaveBeenCalledTimes(8);

		finishTask(0.01);
		expect(now).toHaveBeenCalledTimes(9);
	});

	it('keeps checking every task when tasks are under the interval but a batch of them would not fit', () => {
		const { clock, finishTask, now } = createClock();

		// Each task is under the 1ms interval, but 8 of them would take 4ms, so each one should read the clock
		for (let i = 0; i < 20; i++) {
			clock.startSlice();
			now.mockClear();

			finishTask(0.5, 1);
			expect(now).toHaveBeenCalledTimes(1);
		}
	});

	it('goes back to checking every task after a slow batch', () => {
		const { clock, finishTask, now } = createClock();

		for (let i = 0; i < 8; i++) {
			finishTask(0.01);
		}

		// A slow task inside the batch is noticed at the end of the batch
		clock.startSlice();
		now.mockClear();

		const results = [finishTask(50)];
		for (let i = 0; i < 7; i++) {
			results.push(finishTask(0.01));
		}

		expect(results).toEqual([false, false, false, false, false, false, false, true]);
		expect(now).toHaveBeenCalledTimes(1);

		// Afterwards, every task is checked again
		clock.startSlice();
		now.mockClear();

		finishTask(0.01);
		finishTask(0.01);
		expect(now).toHaveBeenCalledTimes(2);
	});

	it('keeps yielding until a new slice starts, even between clock checks', () => {
		const { clock, finishTask, now } = createClock();

		for (let i = 0; i < 8; i++) {
			finishTask(0.01);
		}

		// The batch that ends the slice
		for (let i = 0; i < 7; i++) {
			finishTask(0.12);
		}

		expect(finishTask(0.12)).toBe(true);

		// Tasks that finish before the next slice are told to yield without reading the clock
		now.mockClear();
		expect(finishTask(0.01)).toBe(true);
		expect(finishTask(0.01)).toBe(true);
		expect(now).not.toHaveBeenCalled();

		clock.startSlice();
		expect(finishTask(0.01)).toBe(false);
	});

	it('starts a new slice', () => {
		const { clock, finishTask } = createClock();

		expect(finishTask(5)).toBe(true);

		clock.startSlice();
		expect(finishTask(0.5)).toBe(false);
	});

	it('checks every task again after being reset', () => {
		const { clock, finishTask, now } = createClock();

		for (let i = 0; i < 8; i++) {
			finishTask(0.01);
		}

		clock.reset();
		now.mockClear();

		finishTask(0.01);
		expect(now).toHaveBeenCalledTimes(1);
	});
});
