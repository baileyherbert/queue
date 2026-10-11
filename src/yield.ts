/**
 * The number of tasks to run between clock checks once tasks are known to be fast.
 */
const BATCH_SIZE = 8;

/**
 * Decides when a queue should yield to the event loop, based on its `yieldInterval`.
 *
 * Reading the clock after every task is expensive when tasks are tiny, so this checks the clock less often once tasks
 * are known to be fast:
 *
 * - The clock is checked after every task to begin with, so a slow task (including the first one) is noticed
 *   immediately.
 * - Once `BATCH_SIZE` tasks in a row are fast enough that a whole batch of them would fit within the interval, the
 *   clock is only checked once every `BATCH_SIZE` tasks.
 * - If a batch takes longer than the interval, meaning a slow task has appeared, it goes back to checking after
 *   every task.
 *
 * Once a slice is over, every task that finishes is told to yield until the next slice starts. Otherwise, with
 * concurrency, tasks that finish between clock checks would keep starting new tasks and the queue would never yield.
 *
 * Since no task can be interrupted, the queue can still overrun the interval by however long a single slow task
 * takes. Checking in batches adds at most about one interval to that.
 */
export class YieldClock {

	private _now: () => number;

	private _sliceStart = 0;
	private _lastCheck = 0;
	private _numSinceCheck = 0;
	private _checkEvery = 1;
	private _numFastTasks = 0;
	private _isSliceOver = false;

	/**
	 * Constructs a new `YieldClock` instance.
	 *
	 * @param now Returns the current time in milliseconds. Defaults to `performance.now()`, which is looked up on
	 *   each call so that it can be replaced at runtime, such as by fake timers in tests.
	 */
	public constructor(now: () => number = () => performance.now()) {
		this._now = now;
	}

	/**
	 * Resets the clock for a new run of the queue, so that tasks are checked individually again, and starts a new
	 * slice.
	 */
	public reset() {
		this._checkEvery = 1;
		this._numFastTasks = 0;
		this.startSlice();
	}

	/**
	 * Starts a new slice, which should be called after the queue yields to the event loop.
	 */
	public startSlice() {
		this._sliceStart = this._lastCheck = this._now();
		this._numSinceCheck = 0;
		this._isSliceOver = false;
	}

	/**
	 * Records that a task has finished, and returns whether the queue should yield before starting another.
	 *
	 * @param interval The yield interval in milliseconds, which must be a positive finite number.
	 */
	public shouldYield(interval: number): boolean {
		// Keep yielding until the next slice starts
		if (this._isSliceOver) {
			return true;
		}

		// Skip reading the clock until the current batch is complete
		if (++this._numSinceCheck < this._checkEvery) {
			return false;
		}

		const now = this._now();
		const elapsed = now - this._lastCheck;

		// Tasks are fast if a whole batch of them would fit within the interval
		const isFast = elapsed / this._numSinceCheck * BATCH_SIZE < interval;

		if (this._checkEvery === 1) {
			this._numFastTasks = isFast ? this._numFastTasks + 1 : 0;

			if (this._numFastTasks >= BATCH_SIZE) {
				this._checkEvery = BATCH_SIZE;
			}
		}

		// A slow batch means a slow task has appeared, so go back to checking after every task
		else if (!isFast) {
			this._checkEvery = 1;
			this._numFastTasks = 0;
		}

		this._lastCheck = now;
		this._numSinceCheck = 0;
		this._isSliceOver = now - this._sliceStart >= interval;

		return this._isSliceOver;
	}

}
