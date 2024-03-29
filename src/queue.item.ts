import { QueueOptions, TaskOptions } from './common';
import { EventEmitter } from './events';
import { QueueGroup } from './queue.group';

/**
 * An item queue for processing individual items with a concurrency limit and timeouts.
 *
 * This queue's constructor requires a processor function, which accepts a single argument. When items in the queue are
 * ready for processing, this function is invoked with the item as its argument.
 *
 * The processor function can return a promise which resolves when finished.
 */
export class ItemQueue<T = any> extends EventEmitter<Events<T>> {

	/**
	 * The options for this queue.
	 */
	public options: QueueOptions;

	/**
	 * The processor function for this queue.
	 */
	public processor: ItemFunction<T>;

	private _active = false;
	private _stopping = false;
	private _numRunningTasks = 0;

	private _tasks: InternalTaskRecord<T>[];
	private _timeouts: Map<InternalTaskRecord<T>, any>;

	private _stopPromise?: Promise<void>;
	private _stopPromiseResolver?: (...args: any[]) => void;

	/**
	 * Constructs a new `ItemQueue` instance with the given options.
	 *
	 * @param options
	 */
	public constructor(processor: ItemFunction<T>, options?: QueueOptions) {
		super();

		this.options = options || {};
		this.processor = processor;

		this._tasks = [];
		this._timeouts = new Map();
	}

	/**
	 * Whether or not this queue is currently running.
	 */
	public get active(): boolean {
		return this._active;
	}

	/**
	 * The total number of active and pending tasks in the queue.
	 */
	public get length(): number {
		return this._tasks.length + this._numRunningTasks;
	}

	/**
	 * Creates and returns a queue group.
	 *
	 * A queue group is an interface for managing a subset of tasks in a larger queue. It offers the same `push` and
	 * `pushAsync` methods, as well as the same events, but uses this queue as its underlying processor.
	 *
	 * You can create several groups for a queue, and they will all share the same underlying queue, but each group
	 * will only emit events for their own tasks. Note that the queue itself will still emit events for all tasks.
	 */
	public createGroup(): QueueGroup<T> {
		return new QueueGroup<T>(this);
	}

	/**
	 * Returns a `Promise` which resolves once all tasks in the queue are completed. If the queue does not have any
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
	 * Adds an item to the queue.
	 *
	 * @param item The item to process.
	 * @param options Custom options for this specific task.
	 */
	public push(item: T, options?: TaskOptions) {
		this._enqueueTask({
			item,
			options
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
				promiseResolve: resolve,
				promiseReject: reject,
				options
			});
		});
	}

	/**
	 * Starts the queue.
	 */
	public start() {
		// Do nothing if there are no tasks to process
		if (this._tasks.length === 0) {
			return;
		}

		// If the queue is active, just check the first task to see if it's immediate and run it if so
		if (this._numRunningTasks >= this._maxConcurrentTasks) {
			if (this._tasks[0].options?.runImmediately) {
				this._executeTask(this._tasks.shift()!);
			}

			return;
		}

		// Otherwise, run the next available task
		this._executeTask(this._tasks.shift()!);
	}

	/**
	 * Starts the queue and returns a `Promise` which resolves once it has stopped.
	 */
	public startAsync() {
		if (this._stopPromise) {
			return this._stopPromise;
		}

		return this._stopPromise = new Promise<void>(resolve => {
			this._stopPromiseResolver = resolve;
			this.start();
		});
	}

	/**
	 * Gracefully stops the queue, allowing all running tasks to finish.
	 */
	public stop() {
		if (this._active) {
			this._stopping = true;
		}
	}

	/**
	 * Gracefully stops the queue, allowing all running tasks to finish before the returned `Promise` instance is
	 * resolved.
	 */
	public stopAsync(): Promise<void> {
		if (this._active) {
			this.stop();

			if (this._stopPromise) {
				return this._stopPromise;
			}

			return this._stopPromise = new Promise<void>(resolve => {
				this._stopPromiseResolver = resolve;
			});
		}

		// Nothing to do, resolve immediately
		return new Promise(r => r());
	}

	/**
	 * Enqueues a task and starts the queue if necessary. If the given task configured to `runImmediately` then it will
	 * be executed here as well.
	 *
	 * @param task
	 */
	private _enqueueTask(task: InternalTaskRecord<T>) {
		// If this is an immediate task, add it to the beginning of the queue
		// The start() method will always check to see if the first task in the queue is an immediate
		if (task.options?.runImmediately) {
			this._tasks.unshift(task);
		}

		// Otherwise, add the task to the end of the queue
		else {
			this._tasks.push(task);
		}

		// Emit added event
		this._emit('taskAdded', task.item);

		// Start the queue automatically
		if (this._autoStart) {
			this.start();
		}
	}

	/**
	 * Executes the given task.
	 *
	 * @param task
	 */
	private _executeTask(task: InternalTaskRecord<T>) {
		this._beforeExecuteTask(task);

		// Internal state tracking
		let isTaskFinished = false;

		// Get the timeout duration in milliseconds
		const timeoutDuration = task.options?.timeout ?? this._defaultTimeout;

		// Set the timeout if applicable
		if (timeoutDuration > 0) {
			this._timeouts.set(task, setTimeout(() => {
				if (!isTaskFinished) {
					isTaskFinished = true;
					this._afterExecuteTask(task, timeoutDuration);
				}
			}, timeoutDuration));
		}

		// Execute the task with error handling
		try {
			const response = this.processor(task.item);

			// Handle promises
			if (response && typeof response.then === 'function') {
				// Wait for the promise to resolve
				response.then(() => {
					if (!isTaskFinished) {
						isTaskFinished = true;
						this._afterExecuteTask(task);
					}
				})

				// Listen for rejections from the promise as well
				.catch((error: any) => {
					if (!isTaskFinished) {
						isTaskFinished = true;
						this._afterExecuteTask(task, 0, error);
					}
				});
			}

			// Otherwise finish immediately
			else {
				isTaskFinished = true;
				this._afterExecuteTask(task);
			}
		}
		catch (error) {
			isTaskFinished = true;
			this._afterExecuteTask(task, 0, error);
		}
	}

	/**
	 * Performs logic before executing a task.
	 *
	 * @param task
	 */
	private _beforeExecuteTask(task: InternalTaskRecord<T>) {
		// Mark the task as running
		this._numRunningTasks++;

		// Start the queue if necessary
		if (!this._active) {
			this._active = true;
			this._emit('started');
		}

		// Announce that the task is starting
		this._emit('taskStarted', task.item);
	}

	/**
	 * Performs logic after executing a task.
	 *
	 * @param task
	 */
	private _afterExecuteTask(task: InternalTaskRecord<T>, timeout?: number, error?: any) {
		// Remove the task as running
		this._numRunningTasks--;

		// Remove the timeout from the cache
		if (this._timeouts.has(task)) {
			clearTimeout(this._timeouts.get(task));
			this._timeouts.delete(task);
		}

		// Emit timeout event
		if (timeout) {
			this._emit('taskTimedOut', task.item);
		}

		// Emit error event
		else if (typeof error !== 'undefined') {
			if (!(error instanceof Error)) {
				error = new Error(error);
			}

			this._emit('taskFailed', error, task.item);
		}

		// Emit completed event
		else {
			this._emit('taskCompleted', task.item);
		}

		// Convert timeouts into an error, we'll need this for the next few steps
		if (timeout) {
			error = new Error('Task timed out after ' + timeout + ' milliseconds');
		}

		// Always emit the finished event
		this._emit('taskFinished', error, task.item);

		// Invoke the task's resolver
		if (task.promiseResolve && (!timeout && typeof error === 'undefined')) {
			task.promiseResolve();
		}

		// Invoke the task's rejector
		else if (task.promiseReject) {
			task.promiseReject(error);
		}

		// Stop the queue if necessary
		if (this.length === 0 || this._stopping) {
			this._finishStoppingQueue();
		}

		// Otherwise, call start again to run the next task
		else {
			if (this._useAsyncTicking) {
				setTimeout(() => this.start(), 0);
			}
			else {
				this.start();
			}
		}
	}

	/**
	 * Performs cleanup and emits events after the queue has been stopped.
	 */
	private _finishStoppingQueue() {
		// State cleanup
		this._active = false;
		this._stopping = false;
		this._timeouts = new Map();

		// Call the stop resolver if needed
		let resolver: Function | undefined;
		if (this._stopPromiseResolver) {
			resolver = this._stopPromiseResolver;

			this._stopPromiseResolver = undefined;
			this._stopPromise = undefined;
		}

		// Invoke the finished event if applicable
		if (this.length === 0) {
			this._emit('finished');
		}

		// Invoke stopped event
		this._emit('stopped');

		// Invoke the resolver if one was available
		if (resolver) {
			resolver();
		}
	}

	/**
	 * The maximum number of concurrent tasks this queue can run.
	 */
	private get _maxConcurrentTasks() {
		return this.options.maxConcurrentTasks ?? 1;
	}

	/**
	 * The default timeout to use for tasks in milliseconds (or `0` to disable).
	 */
	private get _defaultTimeout() {
		return this.options.defaultTimeout ?? 0;
	}

	/**
	 * Whether or not to automatically start the queue when tasks are added.
	 */
	private get _autoStart() {
		return this.options.autoStart ?? true;
	}

	/**
	 * Whether or not to tick asynchronously.
	 */
	private get _useAsyncTicking() {
		return this.options.useAsyncTicking ?? true;
	}

}

/**
 * The events that the queue can emit.
 */
type Events<T> = {
	/**
	 * Emitted when an item is added to the queue.
	 */
	taskAdded: [item: T];

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
	 * Emitted when the queue is started. If `autoStart` is enabled, this means the queue has started processing new
	 * data.
	 */
	started: [];

	/**
	 * Emitted when the queue is stopped, either manually or because it has finished processing all tasks.
	 */
	stopped: [];

	/**
	 * Emitted when the queue has finished processing all tasks. The `stopped` event will also be emitted after this.
	 */
	finished: [];
};

/**
 * Describes a function with no parameters that returns a promise.
 */
type ItemFunction<T> = (item: T) => any;

/**
 * Describes an internal, queued task.
 */
interface InternalTaskRecord<T> {
	/**
	 * The item to process.
	 */
	item: T;

	/**
	 * The custom options for this task, if provided.
	 */
	options?: TaskOptions;

	/**
	 * The resolve function for the task's tracking promise, if applicable.
	 */
	promiseResolve?: (...args: any[]) => void;

	/**
	 * The reject function for the task's tracking promise, if applicable.
	 */
	promiseReject?: (...args: any[]) => void;
}
