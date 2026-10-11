import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionQueue, ItemQueue } from '../src';
import { deferred, flush, track } from './helpers';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('QueueGroup (via FunctionQueue)', () => {
	/**
	 * Creates a task whose completion is controlled by the test.
	 */
	function controlled() {
		const signal = deferred();
		const task = vi.fn(() => signal.promise);
		return { task, finish: () => signal.resolve(), fail: signal.reject };
	}

	describe('push()', () => {
		it('sends tasks to the underlying queue', () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const added = vi.fn();
			const task = vi.fn();
			queue.on('taskAdded', added);

			group.push(task);

			expect(added).toHaveBeenCalledExactlyOnceWith(task);
			expect(task).toHaveBeenCalledTimes(1);
		});

		it('returns nothing', () => {
			const group = new FunctionQueue().createGroup();

			expect(group.push(() => {})).toBeUndefined();
		});

		it('does not start the queue when autoStart is disabled', async () => {
			const queue = new FunctionQueue({ autoStart: false });
			const group = queue.createGroup();
			const work = vi.fn();

			group.push(work);
			await flush();
			expect(work).not.toHaveBeenCalled();

			queue.start();
			await flush();
			expect(work).toHaveBeenCalledTimes(1);
		});

		it('applies the timeout task option', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const timedOut = vi.fn();
			const { task } = controlled();
			group.on('taskTimedOut', timedOut);

			group.push(task, { timeout: 500 });

			await vi.advanceTimersByTimeAsync(499);
			expect(timedOut).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(timedOut).toHaveBeenCalledExactlyOnceWith(task);
		});

		it('applies the runImmediately task option', () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const blocker = controlled();
			const immediate = controlled();

			group.push(blocker.task);
			group.push(immediate.task, { runImmediately: true });

			expect(immediate.task).toHaveBeenCalledTimes(1);
		});
	});

	describe('pushAsync()', () => {
		it('resolves once the task has executed', async () => {
			const group = new FunctionQueue().createGroup();
			const { task, finish } = controlled();

			const result = track(group.pushAsync(task));
			await flush();
			expect(result.status).toBe('pending');

			finish();
			await flush();
			expect(result.status).toBe('fulfilled');
			expect(result.value).toBeUndefined();
		});

		it('rejects with the error when the task throws', async () => {
			const group = new FunctionQueue().createGroup();
			const error = new Error('failure');

			await expect(group.pushAsync(() => { throw error; })).rejects.toBe(error);
		});

		it('rejects with an Error when the task times out', async () => {
			const group = new FunctionQueue().createGroup();
			const { task } = controlled();

			const result = track(group.pushAsync(task, { timeout: 100 }));
			await vi.advanceTimersByTimeAsync(100);

			expect(result.status).toBe('rejected');
			expect(result.reason).toBeInstanceOf(Error);
		});
	});

	describe('length', () => {
		it('counts the active and pending tasks in the group', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const tasks = [controlled(), controlled()];

			expect(group.length).toBe(0);

			for (const { task } of tasks) {
				group.push(task);
			}

			expect(group.length).toBe(2);

			tasks[0].finish();
			await flush();
			expect(group.length).toBe(1);

			tasks[1].finish();
			await flush();
			expect(group.length).toBe(0);
		});

		it('only counts tasks added through the group', () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const other = queue.createGroup();

			queue.push(controlled().task);
			other.push(controlled().task);
			group.push(controlled().task);

			expect(queue.length).toBe(3);
			expect(group.length).toBe(1);
			expect(other.length).toBe(1);
		});

		it('counts each pushed task when the same item is pushed more than once', () => {
			const queue = new FunctionQueue({ autoStart: false });
			const group = queue.createGroup();
			const task = () => {};

			group.push(task);
			group.push(task);

			expect(queue.length).toBe(2);
			expect(group.length).toBe(2);
		});
	});

	describe('active and destroy()', () => {
		it('is active until destroyed', () => {
			const group = new FunctionQueue().createGroup();

			expect(group.active).toBe(true);

			group.destroy();
			expect(group.active).toBe(false);
		});

		it('still executes outstanding tasks after being destroyed, without emitting events', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const first = controlled();
			const second = controlled();
			const listener = vi.fn();

			for (const event of ['taskStarted', 'taskCompleted', 'taskFailed', 'taskTimedOut', 'taskFinished']) {
				group.on(event as 'taskStarted', listener);
			}

			group.push(first.task);
			group.push(second.task);
			listener.mockClear();

			group.destroy();
			first.finish();
			await flush();
			second.finish();
			await flush();

			expect(first.task).toHaveBeenCalledTimes(1);
			expect(second.task).toHaveBeenCalledTimes(1);
			expect(listener).not.toHaveBeenCalled();
		});

		it('still settles promises from pushAsync() after being destroyed', async () => {
			const group = new FunctionQueue().createGroup();
			const { task, finish } = controlled();

			const result = track(group.pushAsync(task));
			group.destroy();

			finish();
			await flush();

			expect(result.status).toBe('fulfilled');
		});
	});

	describe('getCompletionPromise()', () => {
		it('resolves immediately when the group has no tasks', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			queue.push(controlled().task);

			const result = track(group.getCompletionPromise());
			await flush();

			expect(result.status).toBe('fulfilled');
		});

		it('resolves once the group tasks are finished, even while the queue is still busy', async () => {
			const queue = new FunctionQueue({ maxConcurrentTasks: 2 });
			const group = queue.createGroup();
			const outside = controlled();
			const inside = [controlled(), controlled()];

			queue.push(outside.task);
			for (const { task } of inside) {
				group.push(task);
			}

			const result = track(group.getCompletionPromise());

			inside[0].finish();
			await flush();
			expect(result.status).toBe('pending');

			inside[1].finish();
			await flush();
			expect(result.status).toBe('fulfilled');
			expect(queue.length).toBe(1);
		});

		it('waits for every copy of an item that was pushed more than once', async () => {
			const signals = [deferred(), deferred()];
			let numCalls = 0;
			const queue = new ItemQueue<string>(() => signals[numCalls++].promise, { autoStart: false });
			const group = queue.createGroup();

			group.push('item');
			group.push('item');
			const result = track(group.getCompletionPromise());
			queue.start();

			signals[0].resolve();
			await flush();

			expect(result.status).toBe('pending');
			expect(group.length).toBe(1);

			signals[1].resolve();
			await flush();

			expect(result.status).toBe('fulfilled');
			expect(group.length).toBe(0);
		});
	});

	describe('events', () => {
		it('emits taskStarted, taskCompleted and taskFinished for a successful task', async () => {
			const group = new FunctionQueue().createGroup();
			const started = vi.fn();
			const completed = vi.fn();
			const finished = vi.fn();
			const task = () => {};
			group.on('taskStarted', started);
			group.on('taskCompleted', completed);
			group.on('taskFinished', finished);

			await group.pushAsync(task);

			expect(started).toHaveBeenCalledExactlyOnceWith(task);
			expect(completed).toHaveBeenCalledExactlyOnceWith(task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(undefined, task);
		});

		it('emits taskFailed and taskFinished with the error when a task throws', async () => {
			const group = new FunctionQueue().createGroup();
			const failed = vi.fn();
			const finished = vi.fn();
			const error = new Error('failure');
			const task = () => { throw error; };
			group.on('taskFailed', failed);
			group.on('taskFinished', finished);

			await group.pushAsync(task).catch(() => {});

			expect(failed).toHaveBeenCalledExactlyOnceWith(error, task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(error, task);
		});

		it('emits taskTimedOut and taskFinished with an Error when a task times out', async () => {
			const group = new FunctionQueue().createGroup();
			const timedOut = vi.fn();
			const finished = vi.fn();
			const { task } = controlled();
			group.on('taskTimedOut', timedOut);
			group.on('taskFinished', finished);

			group.push(task, { timeout: 100 });
			await vi.advanceTimersByTimeAsync(100);

			expect(timedOut).toHaveBeenCalledExactlyOnceWith(task);
			expect(finished).toHaveBeenCalledExactlyOnceWith(expect.any(Error), task);
		});

		it('only emits events for its own tasks', async () => {
			const queue = new FunctionQueue();
			const group1 = queue.createGroup();
			const group2 = queue.createGroup();
			const finished1 = vi.fn();
			const finished2 = vi.fn();
			const task1 = () => {};
			const task2 = () => {};
			const rootTask = () => {};
			group1.on('taskFinished', finished1);
			group2.on('taskFinished', finished2);

			group1.push(task1);
			group2.push(task2);
			queue.push(rootTask);
			await flush();

			expect(finished1).toHaveBeenCalledExactlyOnceWith(undefined, task1);
			expect(finished2).toHaveBeenCalledExactlyOnceWith(undefined, task2);
		});

		it('does not emit events for the same item pushed directly to the queue', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const blocker = controlled();
			const { task, finish } = controlled();
			const started = vi.fn();
			group.on('taskStarted', started);

			queue.push(blocker.task);
			queue.push(task);
			group.push(task);

			// The copy pushed directly to the queue starts first
			blocker.finish();
			await flush();

			expect(task).toHaveBeenCalledTimes(1);
			expect(started).not.toHaveBeenCalled();

			// The copy pushed through the group starts next
			finish();
			await flush();

			expect(task).toHaveBeenCalledTimes(2);
			expect(started).toHaveBeenCalledExactlyOnceWith(task);
		});

		it('matches the output of the documented example', async () => {
			const queue = new ItemQueue<string>(() => {});
			const output: string[] = [];

			const group1 = queue.createGroup();
			const group2 = queue.createGroup();

			queue.on('taskFinished', (_error, item) => output.push('Queue: ' + item));

			group1.on('taskFinished', (_error, item) => output.push('Group1: ' + item));
			group2.on('taskFinished', (_error, item) => output.push('Group2: ' + item));

			group1.push('This was added to group1.');
			group2.push('This was added to group2.');
			await flush();

			expect(output).toEqual([
				'Queue: This was added to group1.',
				'Group1: This was added to group1.',
				'Queue: This was added to group2.',
				'Group2: This was added to group2.'
			]);
		});

		it('does not emit events for the same item pushed through another group', async () => {
			const queue = new ItemQueue<string>(() => {}, { autoStart: false, yieldInterval: 0 });
			const group1 = queue.createGroup();
			const group2 = queue.createGroup();
			const finished1 = vi.fn();
			const finished2 = vi.fn();
			group1.on('taskFinished', finished1);
			group2.on('taskFinished', finished2);

			group1.push('item');
			group2.push('item');

			// Only the copy pushed through group1 runs synchronously, the other runs on the next tick
			queue.start();

			expect(finished1).toHaveBeenCalledExactlyOnceWith(undefined, 'item');
			expect(finished2).not.toHaveBeenCalled();

			await flush();

			expect(finished1).toHaveBeenCalledTimes(1);
			expect(finished2).toHaveBeenCalledExactlyOnceWith(undefined, 'item');
		});

		it('invokes queue listeners before group listeners', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const order: string[] = [];

			for (const event of ['taskStarted', 'taskCompleted', 'taskFinished'] as const) {
				group.on(event, () => order.push('group ' + event));
				queue.on(event, () => order.push('queue ' + event));
			}

			await group.pushAsync(() => {});

			expect(order).toEqual([
				'queue taskStarted',
				'group taskStarted',
				'queue taskCompleted',
				'group taskCompleted',
				'queue taskFinished',
				'group taskFinished'
			]);
		});

		it('keeps a consistent state when a listener throws', async () => {
			const queue = new FunctionQueue();
			const group = queue.createGroup();
			const error = new Error('listener failure');
			const { task, finish } = controlled();
			group.on('taskFinished', () => { throw error; });

			const result = track(group.pushAsync(task));
			const completion = track(group.getCompletionPromise());

			finish();
			await expect(flush()).rejects.toBe(error);

			expect(queue.length).toBe(0);
			expect(group.length).toBe(0);
			expect(result.status).toBe('fulfilled');
			expect(completion.status).toBe('fulfilled');
		});
	});
});
