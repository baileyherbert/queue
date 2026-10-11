
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
	 * How long the queue can keep starting tasks back-to-back, in milliseconds, before it yields to the event loop.
	 * Yielding lets promises settle and other code in the application run (such as timers and I/O) while the queue
	 * works through many tasks, especially synchronous, blocking ones.
	 *
	 * - `0` yields after every task, so each task's promise settles before the next task starts.
	 * - A positive number starts tasks back-to-back until that much time has passed since the queue last yielded,
	 *   and then yields once.
	 * - `false` (or `Infinity`) never yields, and starts the next task as soon as a slot is free. This is the
	 *   fastest, but task completion promises might resolve after new tasks start, and compute-heavy tasks can
	 *   block the application.
	 *
	 * Yielding uses `setImmediate` where available, or `MessageChannel` in browsers.
	 *
	 * Default: `1` where `setImmediate` is available (Node and Bun), otherwise `5` (browsers and Deno), since yielding
	 * with `MessageChannel` costs more per yield.
	 */
	yieldInterval?: number | false;
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
