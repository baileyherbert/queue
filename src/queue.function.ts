import { QueueOptions } from './common';
import { BaseQueue } from './queue.base';

/**
 * A function queue for executing functions with a concurrency limit and timeouts.
 *
 * This queue does not have a processor function like the `ItemQueue`. Instead, each function you add to the queue
 * acts as its own individual processor, and can perform any action.
 *
 * This queue also supports functions that return promises.
 */
export class FunctionQueue<F extends FunctionTask = FunctionTask> extends BaseQueue<F> {

	/**
	 * Constructs a new `FunctionQueue` instance with the given options.
	 *
	 * @param options
	 */
	public constructor(options?: QueueOptions) {
		super(options);
	}

	/**
	 * Executes a queued function.
	 *
	 * @param task
	 */
	protected _process(task: F) {
		return task();
	}

}

/**
 * Describes a function with no parameters that returns a promise.
 */
export type FunctionTask<T = any> = () => Promise<T> | T;
