import { QueueOptions } from './common.js';
import { BaseQueue } from './queue.base.js';

/**
 * An item queue for processing individual items with a concurrency limit and timeouts.
 *
 * This queue's constructor requires a processor function, which accepts a single argument. When items in the queue are
 * ready for processing, this function is invoked with the item as its argument.
 *
 * The processor function can return a promise which resolves when finished.
 */
export class ItemQueue<T = any> extends BaseQueue<T> {

	/**
	 * The processor function for this queue.
	 */
	public processor: ItemFunction<T>;

	/**
	 * Constructs a new `ItemQueue` instance with the given options.
	 *
	 * @param processor The function to invoke with each item.
	 * @param options
	 */
	public constructor(processor: ItemFunction<T>, options?: QueueOptions) {
		super(options);

		this.processor = processor;
	}

	/**
	 * Sends a queued item to the processor function.
	 *
	 * @param item
	 */
	protected _process(item: T) {
		return this.processor(item);
	}

}

/**
 * Describes a processor function that accepts a single item and optionally returns a promise.
 */
type ItemFunction<T> = (item: T) => any;
