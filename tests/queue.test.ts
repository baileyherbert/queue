import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionQueue, QueueGroup } from '../src';
import { deferred, flush, track, Tracked } from './helpers';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('queue (via FunctionQueue)', () => {
	/**
	 * Creates a task whose completion is controlled by the test.
	 */
	function controlled() {
		const signal = deferred();
		const task = vi.fn(() => signal.promise);
		return { task, finish: () => signal.resolve(), fail: signal.reject };
	}

	/**
	 * Creates a task that tracks the number of tasks running at once in `counter`.
	 */
	function counted(counter: { running: number; peak: number; }, ms: number) {
		return async () => {
			counter.running++;
			counter.peak = Math.max(counter.peak, counter.running);
			await new Promise(resolve => setTimeout(resolve, ms));
			counter.running--;
		};
	}

	describe('options', () => {
		it('exposes the given options through the options property', () => {
			const options = { autoStart: false, maxConcurrentTasks: 3, defaultTimeout: 500, useAsyncTicking: false };
			const queue = new FunctionQueue(options);

			expect(queue.options).toEqual(options);
		});

		it('starts automatically when tasks are pushed by default (autoStart: true)', () => {
			const queue = new FunctionQueue();
			const work = vi.fn();

			queue.push(work);

			expect(work).toHaveBeenCalledTimes(1);
		});

		it('does not start automatically with autoStart: false', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const work = vi.fn();

			queue.push(work);
			await flush();

			expect(work).not.toHaveBeenCalled();
			expect(queue.active).toBe(false);
			expect(queue.length).toBe(1);
		});

		it('runs one task at a time by default (maxConcurrentTasks: 1)', async () => {
			const queue = new FunctionQueue();
			const counter = { running: 0, peak: 0 };

			for (let i = 0; i < 4; i++) {
				queue.push(counted(counter, 100));
			}

			await vi.advanceTimersByTimeAsync(1000);

			expect(counter.peak).toBe(1);
			expect(queue.length).toBe(0);
		});

		it('runs up to maxConcurrentTasks tasks at once when auto starting', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 3 });
			const counter = { running: 0, peak: 0 };

			for (let i = 0; i < 6; i++) {
				queue.push(counted(counter, 100));
			}

			await vi.advanceTimersByTimeAsync(1000);

			expect(counter.peak).toBe(3);
			expect(queue.length).toBe(0);
		});

		it('runs up to maxConcurrentTasks tasks at once when started manually', async () => {
			const queue = new FunctionQueue({ autoStart: false, maxConcurrentTasks: 3 });
			const counter = { running: 0, peak: 0 };

			for (let i = 0; i < 6; i++) {
				queue.push(counted(counter, 100));
			}

			queue.start();
			await vi.advanceTimersByTimeAsync(1000);

			expect(counter.peak).toBe(3);
			expect(queue.length).toBe(0);
		});

		it('does not exceed maxConcurrentTasks when a synchronous task finishes during start()', async () => {
			const queue = new FunctionQueue({ autoStart: false, maxConcurrentTasks: 2, useAsyncTicking: false });
			const counter = { running: 0, peak: 0 };

			queue.push(() => {
				counter.running++;
				counter.peak = Math.max(counter.peak, counter.running);
				counter.running--;
			});

			for (let i = 0; i < 3; i++) {
				queue.push(counted(counter, 100));
			}

			queue.start();
			await vi.advanceTimersByTimeAsync(1000);

			expect(counter.peak).toBe(2);
			expect(queue.length).toBe(0);
		});

		it('does not time out tasks by default (defaultTimeout: 0)', async () => {
			const queue = new FunctionQueue();
			const { task, finish } = controlled();
			const timedOut = vi.fn();
			queue.on('taskTimedOut', timedOut);

			const result = track(queue.pushAsync(task));
			await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

			expect(timedOut).not.toHaveBeenCalled();
			expect(result.status).toBe('pending');

			finish();
			await flush();

			expect(result.status).toBe('fulfilled');
		});

		it('times out tasks after defaultTimeout milliseconds', async () => {
			const queue = new FunctionQueue({ defaultTimeout: 1000 });
			const { task } = controlled();
			const timedOut = vi.fn();
			queue.on('taskTimedOut', timedOut);

			const result = track(queue.pushAsync(task));

			await vi.advanceTimersByTimeAsync(999);
			expect(result.status).toBe('pending');

			await vi.advanceTimersByTimeAsync(1);
			expect(timedOut).toHaveBeenCalledWith(task);
			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
		});

		it('frees the slot of a timed out task so the next task can start', async () => {
			const queue = new FunctionQueue({ defaultTimeout: 1000 });
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);
			await flush();
			expect(second.task).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1000);
			await flush();

			expect(second.task).toHaveBeenCalledTimes(1);
		});

		it('settles a task promise before starting the next task with useAsyncTicking: true', async () => {
			const queue = new FunctionQueue({ autoStart: false, useAsyncTicking: true });
			const order: string[] = [];

			queue.pushAsync(() => order.push('first started')).then(() => order.push('first settled'));
			queue.push(() => order.push('second started'));

			queue.start();
			await flush();

			expect(order).toEqual(['first started', 'first settled', 'second started']);
		});

		it('is not slowed down by timer clamping with useAsyncTicking: true', async () => {
			vi.useRealTimers();

			const queue = new FunctionQueue({ autoStart: false });
			const start = Date.now();

			// Timers are clamped to at least 1ms in Node, so this would take at least 2 seconds with setTimeout
			for (let i = 0; i < 2000; i++) {
				queue.push(() => {});
			}

			await queue.startAsync();

			expect(Date.now() - start).toBeLessThan(1000);
		});

		it('starts the next task immediately with useAsyncTicking: false', async () => {
			const queue = new FunctionQueue({ autoStart: false, useAsyncTicking: false });
			const order: string[] = [];

			queue.pushAsync(() => order.push('first started')).then(() => order.push('first settled'));
			queue.push(() => order.push('second started'));

			queue.start();
			await flush();

			expect(order).toEqual(['first started', 'second started', 'first settled']);
		});

		it('runs a long queue of synchronous tasks with useAsyncTicking: false', () => {
			const queue = new FunctionQueue({ autoStart: false, useAsyncTicking: false });
			const failed = vi.fn();
			let numRan = 0;
			queue.on('taskFailed', failed);

			for (let i = 0; i < 100000; i++) {
				queue.push(() => numRan++);
			}

			queue.start();

			expect(numRan).toBe(100000);
			expect(failed).not.toHaveBeenCalled();
			expect(queue.length).toBe(0);
		});

		it('drains a large backlog of tasks in linear time', () => {
			const queue = new FunctionQueue({ autoStart: false, useAsyncTicking: false });
			const start = Date.now();

			// Removing tasks with Array.prototype.shift() is quadratic, which takes several seconds at this size
			for (let i = 0; i < 200000; i++) {
				queue.push(() => {});
			}

			queue.start();

			expect(queue.length).toBe(0);
			expect(Date.now() - start).toBeLessThan(1000);
		});

		it('runs a long chain of synchronous tasks that push the next task with useAsyncTicking: false', () => {
			const queue = new FunctionQueue({ useAsyncTicking: false });
			const failed = vi.fn();
			let numRan = 0;
			queue.on('taskFailed', failed);

			const task = () => {
				numRan++;

				if (numRan < 100000) {
					queue.push(task);
				}
			};

			queue.push(task);

			expect(numRan).toBe(100000);
			expect(failed).not.toHaveBeenCalled();
			expect(queue.length).toBe(0);
		});
	});

	describe('task options', () => {
		it('times out a task after its own timeout', async () => {
			const queue = new FunctionQueue();
			const { task } = controlled();

			const result = track(queue.pushAsync(task, { timeout: 500 }));

			await vi.advanceTimersByTimeAsync(499);
			expect(result.status).toBe('pending');

			await vi.advanceTimersByTimeAsync(1);
			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
		});

		it('prefers the task timeout over the default timeout', async () => {
			const queue = new FunctionQueue({ defaultTimeout: 500 });
			const { task, finish } = controlled();

			const result = track(queue.pushAsync(task, { timeout: 2000 }));

			await vi.advanceTimersByTimeAsync(1000);
			expect(result.status).toBe('pending');

			finish();
			await flush();
			expect(result.status).toBe('fulfilled');
		});

		it('clears the timeout of a task that finishes in time', async () => {
			const queue = new FunctionQueue({ defaultTimeout: 500, maxConcurrentTasks: 2 });
			const timedOut = vi.fn();
			const tasks = [controlled(), controlled()];
			queue.on('taskTimedOut', timedOut);

			for (const { task } of tasks) {
				queue.push(task);
			}

			for (const { finish } of tasks) {
				finish();
			}

			await flush();
			expect(queue.length).toBe(0);
			expect(vi.getTimerCount()).toBe(0);

			await vi.advanceTimersByTimeAsync(1000);
			expect(timedOut).not.toHaveBeenCalled();
		});

		it('runs a runImmediately task right away even when the queue is full', async () => {
			const queue = new FunctionQueue();
			const blocker = controlled();
			const pending = controlled();
			const immediate = controlled();

			queue.push(blocker.task);
			queue.push(pending.task);
			queue.push(immediate.task, { runImmediately: true });

			expect(blocker.task).toHaveBeenCalledTimes(1);
			expect(immediate.task).toHaveBeenCalledTimes(1);
			expect(pending.task).not.toHaveBeenCalled();
		});

		it('runs a runImmediately task ahead of pending tasks when the queue is started', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const order: string[] = [];

			queue.push(() => order.push('a'));
			queue.push(() => order.push('b'));
			queue.push(() => order.push('immediate'), { runImmediately: true });

			const result = track(queue.startAsync());
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(order[0]).toBe('immediate');
			expect(order).toHaveLength(3);
		});

		it('runs multiple runImmediately tasks in the order they were pushed', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const order: string[] = [];

			queue.push(() => order.push('a'));
			queue.push(() => order.push('immediate 1'), { runImmediately: true });
			queue.push(() => order.push('immediate 2'), { runImmediately: true });
			queue.push(() => order.push('b'));
			queue.push(() => order.push('immediate 3'), { runImmediately: true });

			const result = track(queue.startAsync());
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(order).toEqual(['immediate 1', 'immediate 2', 'immediate 3', 'a', 'b']);
		});

		it('runs runImmediately tasks pushed while stopping in the order they were pushed', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const order: string[] = [];

			queue.push(first.task);
			queue.push(() => order.push('pending'));
			queue.stop();
			queue.push(() => order.push('immediate 1'), { runImmediately: true });
			queue.push(() => order.push('immediate 2'), { runImmediately: true });

			first.finish();
			await flush();
			expect(order).toEqual([]);

			queue.start();
			await flush();

			expect(order).toEqual(['immediate 1', 'immediate 2', 'pending']);
		});
	});

	describe('properties', () => {
		it('length counts active and pending tasks', async () => {
			const queue = new FunctionQueue();
			const tasks = [controlled(), controlled(), controlled()];

			expect(queue.length).toBe(0);

			for (const { task } of tasks) {
				queue.push(task);
			}

			expect(queue.length).toBe(3);

			tasks[0].finish();
			await flush();
			expect(queue.length).toBe(2);

			tasks[1].finish();
			await flush();
			tasks[2].finish();
			await flush();
			expect(queue.length).toBe(0);
		});

		it('active reflects whether the queue is running', async () => {
			const queue = new FunctionQueue();
			const { task, finish } = controlled();

			expect(queue.active).toBe(false);

			queue.push(task);
			expect(queue.active).toBe(true);

			finish();
			await flush();
			expect(queue.active).toBe(false);
		});
	});

	describe('push()', () => {
		it('returns nothing', () => {
			const queue = new FunctionQueue();

			expect(queue.push(() => {})).toBeUndefined();
		});

		it('runs tasks in the order they were pushed', async () => {
			const queue = new FunctionQueue();
			const order: number[] = [];

			for (let i = 0; i < 5; i++) {
				queue.push(() => order.push(i));
			}

			await flush();

			expect(order).toEqual([0, 1, 2, 3, 4]);
		});

		it('waits for promises returned by tasks before starting the next', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);
			await flush();
			expect(second.task).not.toHaveBeenCalled();

			first.finish();
			await flush();
			expect(second.task).toHaveBeenCalledTimes(1);
		});
	});

	describe('pushAsync()', () => {
		it('resolves once a synchronous task has executed', async () => {
			const queue = new FunctionQueue();
			const work = vi.fn();

			await expect(queue.pushAsync(work)).resolves.toBeUndefined();
			expect(work).toHaveBeenCalledTimes(1);
		});

		it('resolves only once an asynchronous task has finished', async () => {
			const queue = new FunctionQueue();
			const { task, finish } = controlled();

			const result = track(queue.pushAsync(task));
			await flush();
			expect(result.status).toBe('pending');

			finish();
			await flush();
			expect(result.status).toBe('fulfilled');
		});

		it('rejects with the error thrown by a synchronous task', async () => {
			const queue = new FunctionQueue();
			const error = new Error('sync failure');

			await expect(queue.pushAsync(() => { throw error; })).rejects.toBe(error);
		});

		it('rejects with the error from a rejected task promise', async () => {
			const queue = new FunctionQueue();
			const error = new Error('async failure');

			await expect(queue.pushAsync(() => Promise.reject(error))).rejects.toBe(error);
		});

		it('rejects with an Error when a task times out', async () => {
			const queue = new FunctionQueue();
			const { task } = controlled();

			const result = track(queue.pushAsync(task, { timeout: 100 }));
			await vi.advanceTimersByTimeAsync(100);

			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
		});

		it('starts the queue automatically', () => {
			const queue = new FunctionQueue();
			const work = vi.fn();

			queue.pushAsync(work);

			expect(work).toHaveBeenCalledTimes(1);
		});

		it('rejects with an Error that keeps a non-error rejection value as its cause', async () => {
			const queue = new FunctionQueue();
			const value = { code: 42 };

			const result = track(queue.pushAsync(() => Promise.reject(value)));
			await flush();

			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
			expect((result.reason as Error).message).toBe('Task failed with a non-error value');
			expect((result.reason as Error).cause).toBe(value);
		});

		it('rejects with an Error that uses a thrown string as its message', async () => {
			const queue = new FunctionQueue();

			const result = track(queue.pushAsync(() => { throw 'string failure'; }));
			await flush();

			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
			expect((result.reason as Error).message).toBe('string failure');
			expect((result.reason as Error).cause).toBe('string failure');
		});

		it('rejects when a task rejects or throws with undefined', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });

			const rejected = track(queue.pushAsync(() => Promise.reject(undefined)));
			const thrown = track(queue.pushAsync(() => { throw undefined; }));
			await flush();

			expect(rejected.status).toBe('rejected');
			expect(rejected.reason).toBeInstanceOf(Error);
			expect(thrown.status).toBe('rejected');
			expect(thrown.reason).toBeInstanceOf(Error);
		});
	});

	describe('start()', () => {
		it('starts processing tasks when autoStart is disabled', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const works = [vi.fn(), vi.fn()];

			for (const work of works) {
				queue.push(work);
			}

			queue.start();
			await flush();

			expect(works[0]).toHaveBeenCalledTimes(1);
			expect(works[1]).toHaveBeenCalledTimes(1);
			expect(queue.length).toBe(0);
		});

		it('returns nothing', () => {
			const queue = new FunctionQueue({ autoStart: false });
			queue.push(() => {});

			expect(queue.start()).toBeUndefined();
		});

		it('resumes pending tasks after the queue was stopped', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = vi.fn();

			queue.push(first.task);
			queue.push(second);
			queue.stop();
			first.finish();
			await flush();
			expect(second).not.toHaveBeenCalled();

			queue.start();
			await flush();
			expect(second).toHaveBeenCalledTimes(1);
		});

		it('cancels a pending stop and continues processing tasks', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();
			const stopped = vi.fn();
			queue.on('stopped', stopped);

			queue.push(first.task);
			queue.push(second.task);
			queue.stop();
			queue.start();

			first.finish();
			await flush();

			expect(second.task).toHaveBeenCalledTimes(1);
			expect(stopped).not.toHaveBeenCalled();

			second.finish();
			await flush();

			expect(stopped).toHaveBeenCalledTimes(1);
			expect(queue.length).toBe(0);
		});
	});

	describe('startAsync()', () => {
		it('starts the queue and resolves once it has stopped', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const { task, finish } = controlled();
			queue.push(task);

			const result = track(queue.startAsync());
			await flush();

			expect(queue.active).toBe(true);
			expect(result.status).toBe('pending');

			finish();
			await flush();

			expect(queue.active).toBe(false);
			expect(result.status).toBe('fulfilled');
		});

		it('returns a promise that resolves once a running queue stops', async () => {
			const queue = new FunctionQueue();
			const { task, finish } = controlled();
			queue.push(task);

			const result = track(queue.startAsync());
			await flush();

			expect(task).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('pending');

			finish();
			await flush();
			expect(result.status).toBe('fulfilled');
		});

		it('resolves when there are no tasks to process', async () => {
			const queue = new FunctionQueue();

			const result = track(queue.startAsync());
			await flush();

			expect(result.status).toBe('fulfilled');
		});

		it('does not emit events when there are no tasks to process', async () => {
			const queue = new FunctionQueue();
			const listener = vi.fn();

			for (const event of ['started', 'stopped', 'finished'] as const) {
				queue.on(event, listener);
			}

			const result = track(queue.startAsync());
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(listener).not.toHaveBeenCalled();
			expect(queue.active).toBe(false);
		});

		it('still processes tasks pushed after resolving with no tasks', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const task = vi.fn();

			const emptyResult = track(queue.startAsync());
			await flush();

			expect(emptyResult.status).toBe('fulfilled');

			queue.push(task);
			const result = track(queue.startAsync());
			await flush();

			expect(task).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('fulfilled');
		});

		it('starts the queue again after a previous call finished synchronously', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const first = vi.fn();
			const second = vi.fn();

			queue.push(first);
			const firstResult = track(queue.startAsync());
			await flush();

			expect(firstResult.status).toBe('fulfilled');

			queue.push(second);
			const secondResult = track(queue.startAsync());
			await flush();

			expect(second).toHaveBeenCalledTimes(1);
			expect(secondResult.status).toBe('fulfilled');
		});

		it('cancels a pending stop and resolves once the queue stops', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);
			queue.stop();

			const result = track(queue.startAsync());

			first.finish();
			await flush();

			expect(second.task).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('pending');

			second.finish();
			await flush();

			expect(result.status).toBe('fulfilled');
		});
	});

	describe('stop()', () => {
		it('lets the active task finish but does not start new tasks', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();
			const stopped = vi.fn();
			queue.on('stopped', stopped);

			queue.push(first.task);
			queue.push(second.task);
			queue.stop();

			expect(queue.active).toBe(true);
			expect(stopped).not.toHaveBeenCalled();

			first.finish();
			await flush();

			expect(second.task).not.toHaveBeenCalled();
			expect(stopped).toHaveBeenCalledTimes(1);
			expect(queue.active).toBe(false);
			expect(queue.length).toBe(1);
		});

		it('lets all active tasks finish before stopping when running concurrently', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const first = controlled();
			const second = controlled();
			const stopped = vi.fn();
			queue.on('stopped', stopped);

			queue.push(first.task);
			queue.push(second.task);
			queue.stop();

			first.finish();
			await flush();

			expect(stopped).not.toHaveBeenCalled();
			expect(queue.active).toBe(true);

			second.finish();
			await flush();

			expect(stopped).toHaveBeenCalledTimes(1);
			expect(queue.active).toBe(false);
		});

		it('does not start new tasks when running concurrently', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const first = controlled();
			const second = controlled();
			const third = controlled();

			queue.push(first.task);
			queue.push(second.task);
			queue.push(third.task);
			queue.stop();

			first.finish();
			await flush();
			second.finish();
			await flush();

			expect(third.task).not.toHaveBeenCalled();
			expect(queue.length).toBe(1);
		});

		it('returns nothing', () => {
			const queue = new FunctionQueue();

			expect(queue.stop()).toBeUndefined();
		});

		it('does not start tasks pushed while stopping', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const first = controlled();
			const pushed = vi.fn();

			queue.push(first.task);
			queue.stop();
			queue.push(pushed);
			await flush();

			expect(pushed).not.toHaveBeenCalled();

			first.finish();
			await flush();

			expect(pushed).not.toHaveBeenCalled();
			expect(queue.active).toBe(false);
			expect(queue.length).toBe(1);
		});

		it('does not start runImmediately tasks pushed while stopping', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const immediate = vi.fn();

			queue.push(first.task);
			queue.stop();
			queue.push(immediate, { runImmediately: true });

			expect(immediate).not.toHaveBeenCalled();

			first.finish();
			await flush();

			expect(immediate).not.toHaveBeenCalled();
			expect(queue.length).toBe(1);
		});

		it('stops the queue when called in between tasks', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const second = vi.fn();
			const stopped = vi.fn();
			queue.on('stopped', stopped);

			queue.pushAsync(() => {}).then(() => queue.stop());
			queue.push(second);
			queue.start();
			await flush();

			expect(second).not.toHaveBeenCalled();
			expect(stopped).toHaveBeenCalledTimes(1);
			expect(queue.active).toBe(false);
		});
	});

	describe('stopAsync()', () => {
		it('resolves once the active task has finished', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);

			const result = track(queue.stopAsync());
			await flush();
			expect(result.status).toBe('pending');

			first.finish();
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(second.task).not.toHaveBeenCalled();
		});

		it('resolves only once all active tasks have finished when running concurrently', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);

			const result = track(queue.stopAsync());

			first.finish();
			await flush();
			expect(result.status).toBe('pending');

			second.finish();
			await flush();
			expect(result.status).toBe('fulfilled');
		});

		it('resolves immediately when the queue is not running', async () => {
			const queue = new FunctionQueue();

			const result = track(queue.stopAsync());
			await flush();

			expect(result.status).toBe('fulfilled');
		});

		it('resolves when called in between tasks', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const second = vi.fn();
			let result: Tracked<void> | undefined;

			queue.pushAsync(() => {}).then(() => result = track(queue.stopAsync()));
			queue.push(second);
			queue.start();
			await flush();

			expect(second).not.toHaveBeenCalled();
			expect(result?.status).toBe('fulfilled');
		});

		it('resolves once the queue stops after the stop is cancelled with start()', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const second = controlled();

			queue.push(first.task);
			queue.push(second.task);

			const result = track(queue.stopAsync());
			queue.start();

			first.finish();
			await flush();

			expect(second.task).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('pending');

			second.finish();
			await flush();

			expect(result.status).toBe('fulfilled');
		});
	});

	describe('createGroup()', () => {
		it('returns a QueueGroup', () => {
			const queue = new FunctionQueue();

			expect(queue.createGroup()).toBeInstanceOf(QueueGroup);
		});

		it('returns a new group each time', () => {
			const queue = new FunctionQueue();

			expect(queue.createGroup()).not.toBe(queue.createGroup());
		});
	});

	describe('getCompletionPromise()', () => {
		it('resolves immediately when there are no tasks', async () => {
			const queue = new FunctionQueue();

			const result = track(queue.getCompletionPromise());
			await flush();

			expect(result.status).toBe('fulfilled');
		});

		it('resolves once all tasks have completed', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const tasks = [controlled(), controlled(), controlled()];

			for (const { task } of tasks) {
				queue.push(task);
			}

			const result = track(queue.getCompletionPromise());

			for (const { finish } of tasks) {
				await flush();
				expect(result.status).toBe('pending');
				finish();
			}

			await flush();
			expect(result.status).toBe('fulfilled');
			expect(queue.length).toBe(0);
		});
	});

	describe('events', () => {
		it('emits taskAdded when a task is pushed', () => {
			const queue = new FunctionQueue({ autoStart: false });
			const listener = vi.fn();
			const task = () => {};
			queue.on('taskAdded', listener);

			queue.push(task);

			expect(listener).toHaveBeenCalledExactlyOnceWith(task);
		});

		it('emits taskStarted when a task starts', () => {
			const queue = new FunctionQueue({ autoStart: false });
			const listener = vi.fn();
			const { task } = controlled();
			queue.on('taskStarted', listener);

			queue.push(task);
			expect(listener).not.toHaveBeenCalled();

			queue.start();
			expect(listener).toHaveBeenCalledExactlyOnceWith(task);
			expect(task).toHaveBeenCalledTimes(1);
		});

		it('emits taskCompleted and taskFinished when a task succeeds', async () => {
			const queue = new FunctionQueue();
			const completed = vi.fn();
			const finished = vi.fn();
			const failed = vi.fn();
			const task = () => {};
			queue.on('taskCompleted', completed);
			queue.on('taskFinished', finished);
			queue.on('taskFailed', failed);

			await queue.pushAsync(task);

			expect(completed).toHaveBeenCalledExactlyOnceWith(task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(undefined, task);
			expect(failed).not.toHaveBeenCalled();
		});

		it('emits taskFailed and taskFinished with the error when a task throws', async () => {
			const queue = new FunctionQueue();
			const failed = vi.fn();
			const finished = vi.fn();
			const completed = vi.fn();
			const error = new Error('failure');
			const task = () => { throw error; };
			queue.on('taskFailed', failed);
			queue.on('taskFinished', finished);
			queue.on('taskCompleted', completed);

			await queue.pushAsync(task).catch(() => {});

			expect(failed).toHaveBeenCalledExactlyOnceWith(error, task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(error, task);
			expect(completed).not.toHaveBeenCalled();
		});

		it('emits taskFailed with an Error when a task rejects', async () => {
			const queue = new FunctionQueue();
			const failed = vi.fn();
			const error = new Error('failure');
			const task = () => Promise.reject(error);
			queue.on('taskFailed', failed);

			await queue.pushAsync(task).catch(() => {});

			expect(failed).toHaveBeenCalledExactlyOnceWith(error, task);
		});

		it('emits taskTimedOut and taskFinished with an Error when a task times out', async () => {
			const queue = new FunctionQueue();
			const timedOut = vi.fn();
			const finished = vi.fn();
			const completed = vi.fn();
			const { task, finish } = controlled();
			queue.on('taskTimedOut', timedOut);
			queue.on('taskFinished', finished);
			queue.on('taskCompleted', completed);

			queue.push(task, { timeout: 100 });
			await vi.advanceTimersByTimeAsync(100);

			expect(timedOut).toHaveBeenCalledExactlyOnceWith(task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(expect.any(Error), task);

			finish();
			await flush();

			expect(completed).not.toHaveBeenCalled();
			expect(finished).toHaveBeenCalledTimes(1);
		});

		it('emits started once when the queue starts processing', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const started = vi.fn();
			queue.on('started', started);

			queue.push(() => {});
			queue.push(() => {});
			queue.push(() => {});
			expect(started).not.toHaveBeenCalled();

			queue.start();
			await flush();
			expect(started).toHaveBeenCalledTimes(1);
		});

		it('emits started again when new tasks arrive after the queue stopped', async () => {
			const queue = new FunctionQueue();
			const started = vi.fn();
			queue.on('started', started);

			await queue.pushAsync(() => {});
			await flush();
			await queue.pushAsync(() => {});

			expect(started).toHaveBeenCalledTimes(2);
		});

		it('emits finished and then stopped once all tasks are processed', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const events: string[] = [];
			queue.on('taskFinished', () => events.push('taskFinished'));
			queue.on('finished', () => events.push('finished'));
			queue.on('stopped', () => events.push('stopped'));

			queue.push(() => {});
			queue.push(() => {});
			queue.start();
			await flush();

			expect(events).toEqual(['taskFinished', 'taskFinished', 'finished', 'stopped']);
		});

		it('emits stopped but not finished when stopped manually with tasks remaining', async () => {
			const queue = new FunctionQueue();
			const first = controlled();
			const finished = vi.fn();
			const stopped = vi.fn();
			queue.on('finished', finished);
			queue.on('stopped', stopped);

			queue.push(first.task);
			queue.push(() => {});
			queue.stop();
			first.finish();
			await flush();

			expect(stopped).toHaveBeenCalledTimes(1);
			expect(finished).not.toHaveBeenCalled();
		});

		it('calls once() listeners only one time', async () => {
			const queue = new FunctionQueue();
			const listener = vi.fn();
			queue.once('taskStarted', listener);

			queue.push(() => {});
			queue.push(() => {});
			await flush();

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('keeps a consistent state when a listener throws during a synchronous task', async () => {
			const queue = new FunctionQueue();
			const error = new Error('listener failure');
			const finished = vi.fn();
			queue.on('taskCompleted', () => { throw error; });
			queue.on('taskFinished', finished);

			const result = track(queue.pushAsync(() => {}));

			expect(queue.length).toBe(0);
			expect(queue.active).toBe(false);
			expect(finished).toHaveBeenCalledTimes(1);

			await expect(flush()).rejects.toBe(error);
			expect(result.status).toBe('fulfilled');
		});

		it('keeps processing tasks when a listener throws during an asynchronous task', async () => {
			const queue = new FunctionQueue();
			const error = new Error('listener failure');
			const first = controlled();
			const second = controlled();
			queue.on('taskCompleted', () => { throw error; });

			const result = track(queue.pushAsync(first.task));
			queue.push(second.task);

			first.finish();
			await expect(flush()).rejects.toBe(error);
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(second.task).toHaveBeenCalledTimes(1);
			expect(queue.length).toBe(1);
		});

		it('calls the remaining listeners when a listener throws', async () => {
			const queue = new FunctionQueue();
			const error = new Error('listener failure');
			const listener = vi.fn();
			queue.on('taskStarted', () => { throw error; });
			queue.on('taskStarted', listener);

			queue.push(() => {});

			expect(listener).toHaveBeenCalledTimes(1);
			await expect(flush()).rejects.toBe(error);
		});

		it('emits taskFailed instead of taskCompleted when a task rejects with undefined', async () => {
			const queue = new FunctionQueue();
			const failed = vi.fn();
			const completed = vi.fn();
			const task = () => Promise.reject(undefined);
			queue.on('taskFailed', failed);
			queue.on('taskCompleted', completed);

			queue.push(task);
			await flush();

			expect(completed).not.toHaveBeenCalled();
			expect(failed).toHaveBeenCalledExactlyOnceWith(expect.any(Error), task);
		});
	});
});
