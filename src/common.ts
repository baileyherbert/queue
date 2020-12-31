
/**
 * Describes the options to use for a queue instance.
 */
export interface QueueOptions {
	/**
	 * Whether or not the queue should be started automatically when a task is inserted.
	 *
	 * If set to false, then you must call `start()` on the queue to start processing tasks. In addition, each time the
	 * queue stops due to being empty, you will also need to start it manually the next time you add data.
	 *
	 * Default: `true`
	 */
	autoStart?: boolean;

	/**
	 * The number of tasks that can run concurrently. If there are more tasks in the queue than this value, then the
	 * extra tasks will be held until one of the concurrent tasks are completed.
	 *
	 * Default: `1`
	 */
	maxConcurrentTasks?: number;

	/**
	 * The default number of milliseconds to wait before tasks time out, or `0` to disable. When a task times out, the
	 * task's function will continue executing, but the queue will drop the slot reservation and start the next
	 * available task.
	 *
	 * Default: `0`
	 */
	defaultTimeout?: number;

	/**
	 * When a task completes, this option changes how the next task is started.
	 *
	 * If true, the next task will be scheduled to run after a few milliseconds with `setTimeout`. This will allow
	 * promises to settle and other code in the application to execute if the queue has synchronous, blocking tasks.
	 *
	 * If false, the next task will be invoked immediately. As a result, task completion promises might resolve
	 * after new tasks start, and compute-heavy tasks can slow the application overall.
	 *
	 * Default: `true`
	 */
	useAsyncTicking?: boolean;
}

/**
 * Describes options that can be set per task.
 */
export interface TaskOptions {
	/**
	 * The number of milliseconds to wait before the task times out, or `0` to disable.
	 * Defaults to the value of `defaultTimeout` in the queue instance.
	 */
	timeout?: number;

	/**
	 * Whether or not this task should execute immediately, even if the number of active tasks is equal to or exceeding
	 * the value of `maxConcurrentTasks`.
	 */
	runImmediately?: boolean;
}
