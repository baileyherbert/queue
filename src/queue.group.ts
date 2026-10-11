import { TaskOptions } from './common.js';
import { EventEmitter } from './events.js';
import type { BaseQueue, InternalTaskRecord } from './queue.base.js';

/**
 * This class is used to help manage separate groups of tasks in the same queue.
 *
 * You can get an instance with `queue.createGroup()`.
 */
export class QueueGroup<T> extends EventEmitter<Events<T>> {

	private _queue: BaseQueue<T>;

	private _active = true;
	private _activeTasks: Set<InternalTaskRecord<T>>;
	private _pendingTasks: Set<InternalTaskRecord<T>>;

	/**
	 * Constructs a new group for the given queue. Prefer `queue.createGroup()` over calling this directly.
	 *
	 * @param queue The queue that will process the group's tasks.
	 */
	public constructor(queue: BaseQueue<T>) {
		super();

		this._queue = queue;
		this._activeTasks = new Set();
		this._pendingTasks = new Set();
	}

	/**
	 * Whether or not this group is active.
	 */
	public get active(): boolean {
		return this._active;
	}

	/**
	 * The total number of active and pending tasks in this group.
	 */
	public get length(): number {
		return this._pendingTasks.size + this._activeTasks.size;
	}

	/**
	 * Destroys the group. Its pending and active tasks will still be executed by the queue, but the group will no
	 * longer emit events for them.
	 */
	public destroy() {
		this._active = false;
	}

	/**
	 * Adds an item to the queue.
	 *
	 * @param item The item to process.
	 * @param options Custom options for this specific task.
	 */
	public push(item: T, options?: TaskOptions) {
		this._enqueueTask({
			item,
			options,
			group: this
		});
	}

	/**
	 * Adds an item to the queue and returns a `Promise` to track it. The promise will resolve once the item is done
	 * processing, or rejects if the processor threw an error or timed out.
	 *
	 * @param item The item to process.
	 * @param options Custom options for this specific task.
	 */
	public pushAsync(item: T, options?: TaskOptions): Promise<void> {
		return new Promise((resolve, reject) => {
			this._enqueueTask({
				item,
				options,
				group: this,
				promiseResolve: resolve,
				promiseReject: reject
			});
		});
	}

	/**
	 * Returns a `Promise` which resolves once all items in this group are completed. If the group does not have any
	 * tasks, the promise will be resolved immediately.
	 */
	public getCompletionPromise() {
		if (this.length === 0) {
			return Promise.resolve();
		}

		return new Promise<void>(resolve => {
			this.once('finished', resolve);
		});
	}

	/**
	 * Receives an event from the queue for one of this group's tasks, updates the group's state, and emits the event
	 * from the group as well.
	 *
	 * @internal
	 * @param task The task the event belongs to.
	 * @param event The name of the event.
	 * @param args The arguments the queue emitted the event with.
	 */
	public _receiveTaskEvent<E extends TaskEventName>(task: InternalTaskRecord<T>, event: E, ...args: Events<T>[E]) {
		// Destroyed groups no longer track their tasks or emit events
		if (!this._active) {
			return;
		}

		// Move started tasks from pending to active
		if (event === 'taskStarted') {
			this._pendingTasks.delete(task);
			this._activeTasks.add(task);
		}

		// Remove finished tasks
		else if (event === 'taskFinished') {
			this._activeTasks.delete(task);
		}

		this._emit(event, ...args);

		// Emit the finished event once the group has no tasks left
		if (event === 'taskFinished' && this.length === 0) {
			this._emit('finished');
		}
	}

	/**
	 * Tracks a task as pending in this group and sends it to the queue.
	 *
	 * @param task
	 */
	private _enqueueTask(task: InternalTaskRecord<T>) {
		// Add the task before enqueueing it, since the queue might start it immediately
		this._pendingTasks.add(task);
		this._queue._enqueueTask(task);
	}

}

/**
 * The names of the task events that queues forward to groups.
 *
 * @internal
 */
export type TaskEventName = 'taskStarted' | 'taskCompleted' | 'taskTimedOut' | 'taskFailed' | 'taskFinished';

/**
 * The events that the queue can emit.
 */
type Events<T> = {
	/**
	 * Emitted when the queue starts processing an item.
	 */
	taskStarted: [item: T];

	/**
	 * Emitted after an item finished processing successfully.
	 */
	taskCompleted: [item: T];

	/**
	 * Emitted when processing an item timed out and it was dropped from the queue.
	 */
	taskTimedOut: [item: T];

	/**
	 * Emitted when a processing an item threw an error.
	 */
	taskFailed: [error: Error, item: T];

	/**
	 * Emitted when an item has finished. If the task timed out or threw an error, the error will be provided as the
	 * first parameter.
	 */
	taskFinished: [error: Error | undefined, item: T];

	/**
	 * Emitted when the queue has finished processing all tasks. The `stopped` event will also be emitted after this.
	 */
	finished: [];
};
