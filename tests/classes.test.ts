import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionQueue, ItemQueue } from '../src';
import { deferred, flush, track } from './helpers';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('FunctionQueue', () => {
	it('executes each pushed function', () => {
		const queue = new FunctionQueue();
		const first = vi.fn();
		const second = vi.fn();

		queue.push(first);
		queue.push(second);

		expect(first).toHaveBeenCalledExactlyOnceWith();
		expect(second).toHaveBeenCalledExactlyOnceWith();
	});

	it('waits for the promise returned by the function', async () => {
		const queue = new FunctionQueue();
		const signal = deferred();

		const result = track(queue.pushAsync(() => signal.promise));
		await flush();
		expect(result.status).toBe('pending');

		signal.resolve();
		await flush();
		expect(result.status).toBe('fulfilled');
	});

	it('fails the task when the function throws or rejects', async () => {
		const queue = new FunctionQueue();
		const failed = vi.fn();
		const error = new Error('failure');
		const throws = () => { throw error; };
		const rejects = () => Promise.reject(error);
		queue.on('taskFailed', failed);

		await expect(queue.pushAsync(throws)).rejects.toBe(error);
		await expect(queue.pushAsync(rejects)).rejects.toBe(error);

		expect(failed.mock.calls).toEqual([[error, throws], [error, rejects]]);
	});

	it('passes the pushed function to event listeners', async () => {
		const queue = new FunctionQueue();
		const added = vi.fn();
		const finished = vi.fn();
		const task = vi.fn();
		queue.on('taskAdded', added);
		queue.on('taskFinished', finished);

		await queue.pushAsync(task);

		expect(added).toHaveBeenCalledExactlyOnceWith(task);
		expect(finished).toHaveBeenCalledExactlyOnceWith(undefined, task);
	});
});

describe('ItemQueue', () => {
	it('sends each pushed item to the processor', () => {
		const processor = vi.fn();
		const queue = new ItemQueue<string>(processor);

		queue.push('Do some work!');
		queue.push('Do some more work!');

		expect(processor.mock.calls).toEqual([['Do some work!'], ['Do some more work!']]);
	});

	it('accepts options as the second constructor argument', () => {
		const queue = new ItemQueue(() => {}, { autoStart: false, maxConcurrentTasks: 2 });

		expect(queue.options).toEqual({ autoStart: false, maxConcurrentTasks: 2 });
	});

	it('waits for the promise returned by the processor', async () => {
		const signal = deferred();
		const queue = new ItemQueue<string>(() => signal.promise);

		const result = track(queue.pushAsync('item'));
		await flush();
		expect(result.status).toBe('pending');

		signal.resolve();
		await flush();
		expect(result.status).toBe('fulfilled');
	});

	it('fails the task when the processor throws or rejects', async () => {
		const error = new Error('failure');
		const queue = new ItemQueue<string>(item => {
			if (item === 'throw') {
				throw error;
			}

			return Promise.reject(error);
		});
		const failed = vi.fn();
		queue.on('taskFailed', failed);

		await expect(queue.pushAsync('throw')).rejects.toBe(error);
		await expect(queue.pushAsync('reject')).rejects.toBe(error);

		expect(failed.mock.calls).toEqual([[error, 'throw'], [error, 'reject']]);
	});

	it('passes the pushed item to event listeners', async () => {
		const queue = new ItemQueue<string>(() => {});
		const added = vi.fn();
		const finished = vi.fn();
		queue.on('taskAdded', added);
		queue.on('taskFinished', finished);

		await queue.pushAsync('item');

		expect(added).toHaveBeenCalledExactlyOnceWith('item');
		expect(finished).toHaveBeenCalledExactlyOnceWith(undefined, 'item');
	});
});
