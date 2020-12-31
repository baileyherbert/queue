import { TaskOptions } from './common';
import { EventEmitter } from './events';
import { FunctionQueue } from './queue.function';
import { ItemQueue } from './queue.item';

/**
 * This class is used to help manage separate groups of tasks in the same queue.
 *
 * You can get an instance with `queue.createGroup()`.
 */
export class QueueGroup<T> extends EventEmitter<Events<T>> {

	private _queue: Queue;

	private _active = true;
	private _activeTasks: Set<T>;
	private _pendingTasks: Set<T>;

	private _listeners: Map<string, Function>;

	public constructor(queue: Queue) {
		super();

		this._queue = queue;
		this._activeTasks = new Set();
		this._pendingTasks = new Set();
		this._listeners = new Map();

		this._attachListeners();
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
	 * Destroys the group, which effectively removes queue listeners.
	 */
	public destroy() {
		this._detachListeners();
		this._active = false;
	}

	/**
	 * Adds an item to the queue.
	 *
	 * @param item The item to process.
	 * @param options Custom options for this specific task.
	 */
	public push(item: T, options?: TaskOptions) {
		this._pendingTasks.add(item);
		this._queue.push(item as any, options);
	}

	/**
	 * Adds an item to the queue and returns a `Promise` to track it. The promise will resolve once the item is done
	 * processing, or rejects if the processor threw an error or timed out.
	 *
	 * @param item The item to process.
	 * @param options Custom options for this specific task.
	 */
	public pushAsync(item: T, options?: TaskOptions): Promise<void> {
		this._pendingTasks.add(item);
		return this._queue.pushAsync(item as any, options);
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
	 * Attaches listeners to the queue and stores them locally so they can be detached later.
	 */
	private _attachListeners() {
		const taskStarted = (item: any) => {
			if (this._pendingTasks.has(item)) {
				this._pendingTasks.delete(item);
				this._activeTasks.add(item);
				this._emit('taskStarted', item);
			}
		};

		const taskCompleted = (item: any) => {
			if (this._activeTasks.has(item)) {
				this._emit('taskCompleted', item);
			}
		};

		const taskFailed = (error: Error, item: any) => {
			if (this._activeTasks.has(item)) {
				this._emit('taskFailed', error, item);
			}
		};

		const taskTimedOut = (item: any) => {
			if (this._activeTasks.has(item)) {
				this._emit('taskTimedOut', item);
			}
		};

		const taskFinished = (error: Error | undefined, item: any) => {
			if (this._activeTasks.has(item)) {
				this._activeTasks.delete(item);
				this._emit('taskFinished', error, item);

				if (this.length === 0) {
					this._emit('finished');
				}
			}
		}

		const attach: Function = this._queue.on.bind(this._queue);
		attach('taskStarted', taskStarted);
		attach('taskCompleted', taskCompleted);
		attach('taskFailed', taskFailed);
		attach('taskTimedOut', taskTimedOut)
		attach('taskFinished', taskFinished);

		this._listeners.set('taskStarted', taskStarted);
		this._listeners.set('taskCompleted', taskCompleted);
		this._listeners.set('taskFailed', taskFailed);
		this._listeners.set('taskTimedOut', taskTimedOut);
		this._listeners.set('taskFinished', taskFinished);
	}

	/**
	 * Removes listeners from the queue.
	 */
	private _detachListeners() {
		for (const [event, callback] of this._listeners) {
			const detach: Function = this._queue.removeListener.bind(this._queue);
			detach(event, callback);
		}
	}

}

type Queue = ItemQueue | FunctionQueue;


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
