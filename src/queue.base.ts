import { QueueOptions, TaskOptions } from './common';
import { EventEmitter } from './events';
import { FifoQueue } from './fifo';
import { QueueGroup, TaskEventName } from './queue.group';
import { scheduleTick } from './tick';

/**
 * The shared implementation behind `FunctionQueue` and `ItemQueue`, which handles concurrency, timeouts, events, and
 * task promises.
 *
 * Subclasses only need to implement `_process()`, which defines how a single queued value is executed.
 */
export abstract class BaseQueue<T> extends EventEmitter<QueueEvents<T>> {

	/**
	 * The options for this queue.
	 */
	public options: QueueOptions;

	private _active = false;
	private _stopping = false;
	private _numRunningTasks = 0;

	private _isFilling = false;
	private _needsFill = false;
	private _isTickScheduled = false;

	private _tasks: FifoQueue<InternalTaskRecord<T>>;
	private _immediateTasks: FifoQueue<InternalTaskRecord<T>>;

	private _stopPromise?: Promise<void>;
	private _stopPromiseResolver?: (...args: any[]) => void;

	/**
	 * Constructs a new queue instance with the given options.
	 *
	 * @param options
	 */
	public constructor(options?: QueueOptions) {
		super();

		this.options = options || {};
		this._tasks = new FifoQueue();
		this._immediateTasks = new FifoQueue();
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
		return this._numPendingTasks + this._numRunningTasks;
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
	 * Adds a task to the queue.
	 *
	 * @param task The task to execute.
	 * @param options Custom options for this specific task.
	 */
	public push(task: T, options?: TaskOptions) {
		this._enqueueTask({
			item: task,
			options
		});
	}

	/**
	 * Adds a task to the queue and returns a `Promise` to track it. The promise will resolve once the task is
	 * complete, or rejects if the task threw an error or timed out.
	 *
	 * @param task The task to execute.
	 * @param options Custom options for this specific task.
	 */
	public pushAsync(task: T, options?: TaskOptions): Promise<void> {
		return new Promise((resolve, reject) => {
			this._enqueueTask({
				item: task,
				promiseResolve: resolve,
				promiseReject: reject,
				options
			});
		});
	}

	/**
	 * Starts the queue, running pending tasks until all free slots are filled. Tasks configured to `runImmediately`
	 * at the front of the queue are started even when there are no free slots.
	 *
	 * If the queue is currently stopping, the stop is cancelled and the queue continues processing tasks.
	 */
	public start() {
		// Starting manually cancels a pending stop
		this._stopping = false;
		this._fill();
	}

	/**
	 * Starts the queue and returns a `Promise` which resolves once it has stopped. If the queue isn't running and has
	 * no tasks to process, the promise resolves immediately without emitting any events.
	 */
	public startAsync() {
		// Nothing to do, resolve immediately
		if (!this._active && this._numPendingTasks === 0) {
			return Promise.resolve();
		}

		// Get the promise before starting, in case the queue finishes synchronously
		const promise = this._getStopPromise();
		this.start();

		return promise;
	}

	/**
	 * Gracefully stops the queue, allowing all running tasks to finish. No new tasks will be started, even if they
	 * are pushed with `autoStart` enabled, until `start()` is called again.
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
			const promise = this._getStopPromise();
			this.stop();

			return promise;
		}

		// Nothing to do, resolve immediately
		return new Promise(r => r());
	}

	/**
	 * Executes a single queued value. The queue waits for the returned value to settle if it is a promise, and treats
	 * a thrown error or rejection as a failed task.
	 *
	 * @param item The value that was pushed to the queue.
	 */
	protected abstract _process(item: T): any;

	/**
	 * Enqueues a task and starts the queue if necessary. If the given task configured to `runImmediately` then it will
	 * be executed here as well.
	 *
	 * This is used by `QueueGroup` to enqueue tasks that belong to the group.
	 *
	 * @internal
	 * @param task
	 */
	public _enqueueTask(task: InternalTaskRecord<T>) {
		// If this is an immediate task, add it to the immediate queue
		// The _fill() method will always start immediate tasks before other tasks
		if (task.options?.runImmediately) {
			this._immediateTasks.push(task);
		}

		// Otherwise, add the task to the end of the queue
		else {
			this._tasks.push(task);
		}

		// Emit added event
		this._emit('taskAdded', task.item);

		// Start the queue automatically (unlike start(), this won't cancel a pending stop)
		if (this._autoStart) {
			this._fill();
		}
	}

	/**
	 * Runs pending tasks until all free slots are filled. Tasks configured to `runImmediately` are started first, and
	 * are started even when there are no free slots.
	 *
	 * If the queue is stopping, no tasks are started. Instead, the stop is completed if there are no running tasks
	 * left to wait for, which happens when `stop()` is called in between ticks.
	 *
	 * When `useAsyncTicking` is disabled, synchronous tasks that finish during this method request another fill with
	 * `_needsFill` rather than calling this method recursively, so that the stack doesn't grow with each task.
	 */
	private _fill() {
		// Remember if we're already filling further up the stack, since this can be called by tasks that push tasks
		const wasFilling = this._isFilling;
		this._isFilling = true;

		try {
			do {
				this._needsFill = false;

				if (this._stopping) {
					if (this._numRunningTasks === 0) {
						this._finishStoppingQueue();
					}

					return;
				}

				// Only fill the slots that are free right now, so a synchronous task that finishes during this loop
				// doesn't free its slot for the next task (that's left to the tick, which respects `useAsyncTicking`)
				const freeSlots = this._maxConcurrentTasks - this._numRunningTasks;
				let numStarted = 0;

				while (this._numPendingTasks > 0) {
					// Also check the live count, since tasks can push and start other tasks from within this loop
					const hasFreeSlot = numStarted < freeSlots && this._numRunningTasks < this._maxConcurrentTasks;
					const hasImmediateTask = this._immediateTasks.length > 0;

					if (!hasFreeSlot && !hasImmediateTask) {
						break;
					}

					numStarted++;
					this._executeTask((hasImmediateTask ? this._immediateTasks : this._tasks).shift()!);
				}
			}

			// Fill again if a synchronous tick was requested while filling
			while (this._needsFill);
		}
		finally {
			this._isFilling = wasFilling;
		}
	}

	/**
	 * Schedules the queue to be filled on the next tick, unless a tick is already scheduled. A single fill starts
	 * tasks in all free slots, so tasks that finish before the tick don't need to schedule their own.
	 */
	private _scheduleFill() {
		if (!this._isTickScheduled) {
			this._isTickScheduled = true;

			scheduleTick(() => {
				this._isTickScheduled = false;
				this._fill();
			});
		}
	}

	/**
	 * Returns the `Promise` which resolves the next time the queue stops, creating it if necessary.
	 */
	private _getStopPromise() {
		if (!this._stopPromise) {
			this._stopPromise = new Promise<void>(resolve => {
				this._stopPromiseResolver = resolve;
			});
		}

		return this._stopPromise;
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
			task.timeoutId = setTimeout(() => {
				if (!isTaskFinished) {
					isTaskFinished = true;
					this._afterExecuteTask(task, timeoutDuration);
				}
			}, timeoutDuration);
		}

		// Execute the task with error handling
		// Only the task itself is guarded, so errors from finishing the task aren't mistaken for task errors
		let response: any;

		try {
			response = this._process(task.item);
		}
		catch (error) {
			isTaskFinished = true;
			this._afterExecuteTask(task, 0, toError(error));
			return;
		}

		// Handle promises
		if (response && typeof response.then === 'function') {
			response.then(
				// Wait for the promise to resolve
				() => {
					if (!isTaskFinished) {
						isTaskFinished = true;
						this._afterExecuteTask(task);
					}
				},

				// Listen for rejections from the promise as well
				(error: unknown) => {
					if (!isTaskFinished) {
						isTaskFinished = true;
						this._afterExecuteTask(task, 0, toError(error));
					}
				}
			);
		}

		// Otherwise finish immediately
		else {
			isTaskFinished = true;
			this._afterExecuteTask(task);
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
		this._emitTaskEvent(task, 'taskStarted', task.item);
	}

	/**
	 * Performs logic after executing a task.
	 *
	 * @param task
	 * @param timeout The task's timeout in milliseconds if it timed out.
	 * @param error The error if the task failed.
	 */
	private _afterExecuteTask(task: InternalTaskRecord<T>, timeout?: number, error?: Error) {
		// Remove the task as running
		this._numRunningTasks--;

		// Clear the task's timeout
		if (task.timeoutId !== undefined) {
			clearTimeout(task.timeoutId);
			task.timeoutId = undefined;
		}

		// Emit timeout event
		if (timeout) {
			this._emitTaskEvent(task, 'taskTimedOut', task.item);
		}

		// Emit error event
		else if (typeof error !== 'undefined') {
			this._emitTaskEvent(task, 'taskFailed', error, task.item);
		}

		// Emit completed event
		else {
			this._emitTaskEvent(task, 'taskCompleted', task.item);
		}

		// Convert timeouts into an error, we'll need this for the next few steps
		if (timeout) {
			error = new Error('Task timed out after ' + timeout + ' milliseconds');
		}

		// Always emit the finished event
		this._emitTaskEvent(task, 'taskFinished', error, task.item);

		// Invoke the task's resolver
		if (task.promiseResolve && (!timeout && typeof error === 'undefined')) {
			task.promiseResolve();
		}

		// Invoke the task's rejector
		else if (task.promiseReject) {
			task.promiseReject(error);
		}

		// When stopping, wait for the remaining active tasks to finish before stopping the queue
		if (this._stopping) {
			if (this._numRunningTasks === 0) {
				this._finishStoppingQueue();
			}
		}

		// Stop the queue if there's nothing left to do
		else if (this.length === 0) {
			this._finishStoppingQueue();
		}

		// Otherwise, fill the queue again to run the next task
		else {
			if (this._useAsyncTicking) {
				this._scheduleFill();
			}

			// If the queue is already filling further up the stack, let it fill again rather than recursing
			else if (this._isFilling) {
				this._needsFill = true;
			}

			else {
				this._fill();
			}
		}
	}

	/**
	 * Emits an event for a task, and then forwards it to the task's group if it has one. Emitting from the queue first
	 * means that queue listeners are always invoked before group listeners.
	 *
	 * @param task The task the event belongs to.
	 * @param event The name of the event.
	 * @param args The arguments to emit the event with.
	 */
	private _emitTaskEvent<E extends TaskEventName>(task: InternalTaskRecord<T>, event: E, ...args: QueueEvents<T>[E]) {
		// Checking for listeners first avoids spreading the arguments again, since this runs several times per task
		if (this._hasListeners(event)) {
			this._emit(event, ...args);
		}

		task.group?._receiveTaskEvent(task, event, ...args);
	}

	/**
	 * Performs cleanup and emits events after the queue has been stopped.
	 */
	private _finishStoppingQueue() {
		// State cleanup
		this._active = false;
		this._stopping = false;

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
	 * The number of tasks waiting to be started.
	 */
	private get _numPendingTasks() {
		return this._immediateTasks.length + this._tasks.length;
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
 * Converts a value thrown or rejected by a task into an `Error`. Values that aren't errors are wrapped in a new
 * `Error`, with the original value available as its `cause`.
 *
 * @param value
 */
function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}

	// Strings are typically used as messages, so keep them as the message
	const message = typeof value === 'string' ? value : 'Task failed with a non-error value';

	return new Error(message, { cause: value });
}

/**
 * The events that a queue can emit, where `T` is the type of value pushed to the queue.
 */
type QueueEvents<T> = {
	/**
	 * Emitted when a task is added to the queue.
	 */
	taskAdded: [task: T];

	/**
	 * Emitted when the queue starts running a task.
	 */
	taskStarted: [task: T];

	/**
	 * Emitted when a task is completed successfully.
	 */
	taskCompleted: [task: T];

	/**
	 * Emitted when a task timed out and was dropped from the queue.
	 */
	taskTimedOut: [task: T];

	/**
	 * Emitted when a task threw an error.
	 */
	taskFailed: [error: Error, task: T];

	/**
	 * Emitted when a task has finished. If the task timed out or threw an error, the error will be provided as the
	 * first parameter.
	 */
	taskFinished: [error: Error | undefined, task: T];

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
 * Describes an internal, queued task.
 *
 * @internal
 */
export interface InternalTaskRecord<T> {
	/**
	 * The value that was pushed to the queue.
	 */
	item: T;

	/**
	 * The custom options for this task, if provided.
	 */
	options?: TaskOptions;

	/**
	 * The group that this task was pushed through, if applicable.
	 */
	group?: QueueGroup<T>;

	/**
	 * The handle for the task's timeout while it's running, if it has one.
	 */
	timeoutId?: ReturnType<typeof setTimeout>;

	/**
	 * The resolve function for the task's tracking promise, if applicable.
	 */
	promiseResolve?: (...args: any[]) => void;

	/**
	 * The reject function for the task's tracking promise, if applicable.
	 */
	promiseReject?: (...args: any[]) => void;
}
