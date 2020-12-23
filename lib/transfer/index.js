const { pipeline, PassThrough } = require('readable-stream')
const { nanoid } = require('nanoid')
const errors = require('../errors')
const backoff = require('../backoff')
const createRequestStream = require('./request')
const createSlowRequestStream = require('./fallback-request')
const createProgressStream = require('./track-progress')

/**
 * Transfer constructor
 * @constructor
 * @param {Object} options - Options object
 */
function Transfer(options) {
  // Save options to transfer object
  this.id = nanoid()
  this.options = options
  this.url = options.url
  this.length = options.length
  this.log = options.log || (() => {})

  this.gotOptions = Object.assign({}, options.got)
  this.gotOptions.headers = Object.assign({}, this.gotOptions.headers)
  if (options.needLength) {
    this.gotOptions.headers['accept-encoding'] = 'identity'
  }

  // Init transfer object
  this.attempt = 0
  this.attemptTotal = 0
  this.position = 0
  this.total = undefined
  this.cancelled = false

  // Create output stream
  this.stream = new PassThrough()

  // Add `.cancel()` method to stream
  this.stream.cancel = this.cancel.bind(this)

  // Record transfer object on stream
  this.stream.transfer = this
}

module.exports = Transfer

/**
 * Start transfer.
 * Runs `options.pre` if provided and calls `transfer.get()`.
 * Called at start of transfer and again repeatedly for each retry.
 * @returns {undefined}
 */
Transfer.prototype.start = function () {
  this.attempt++
  this.attemptTotal++
  delete this.err

  this.log('Starting transfer', { id: this.id, transfer: this.toJSON() })

  const { pre } = this.options

  if (!pre) {
    this.get()
    return
  }

  this.log('Calling pre function', { id: this.id })

  this.prePromise = pre(this)
    .then(() => {
      delete this.prePromise

      if (!this.url) {
        throw new errors.PreError('pre function did not set transfer.url')
      }
      if (this.cancelled) throw new errors.CancelError('Transfer cancelled')

      this.log('Completed pre function', { id: this.id, url: this.url })
      this.get()
    })
    .catch((err) => {
      delete this.prePromise
      this.err = err
      this.failed(err, null, true)
    })
}

/**
 * Create HTTP request and pipe to stream.
 * Pipes result of request to output stream.
 * When transfer is complete, `end` event emmitted on output stream.
 * If transfer fails, calls `transfer.failed()` to retry or exit.
 * @returns {undefined}
 */
Transfer.prototype.get = function () {
  const useFallback = !this.supportsRanges && !!this.position
  delete this.err // starting fresh
  this.log('Starting fetch', { id: this.id, useFallback })

  // Set range options
  // Disable compression for ranges as mucks up range request
  if (this.supportsRanges && this.position) {
    this.gotOptions.headers.range = `bytes=${this.position}-`
    this.gotOptions.headers['accept-encoding'] = 'identity'
  }

  // Use `got` module to stream URL
  const requestStream = useFallback
    ? createSlowRequestStream(this, this.position)
    : createRequestStream(this)
  const progressStream = createProgressStream(this, !!this.options.length)
  const outStream = pipeline(requestStream, progressStream, (err) => {
    this.log('Pipeline stream ended', { id: this.id, err })

    delete this.req

    // Check if transfer complete
    if (
      this.position === this.length ||
      this.length == null && this.res && !this.err
    ) {
      // Transfer complete - end output stream
      this.stream.once('unpipe', () => {
        this.stream.end()
      })
      this.log('Finished', { id: this.id })
    } else {
      // Transfer incomplete - try again
      this.failed(
        new errors.TransferError(
          `Transfer stopped before end - at ${this.position} not ${this.length}`
        ),
        this.err,
        !progressStream.received
      )
    }
  })

  outStream.pipe(this.stream, { end: false })
}

/**
 * Called when transfer fails (or `options.preFn` rejects).
 * Retries depending on how many failures, and `attempt` options.
 * Calls `transfer.start()` again to retry, or `transfer.fatal()` if retries exhausted.
 * @returns {undefined}
 */
Transfer.prototype.failed = function (err, original, empty) {
  this.log('Transfer failed', { id: this.id, err, original })

  if (this.options && this.options.shouldRetry) {
    if (!this.options.shouldRetry(err, original, empty)) {
      this.fatal()
      return
    }
  }

  // If transfer cancelled, emit error on stream and stop
  if (this.cancelled) {
    this.fatal()
    return
  }

  // If response from last attempt was not empty, reset attempt timer
  if (!empty) this.attempt = 0

  // If retries limit hit, emit error on stream and stop
  if (
    this.options.attempts && this.attempt >= this.options.attempts ||
    this.options.attemptsTotal &&
      this.attemptTotal >= this.options.attemptsTotal
  ) {
    this.fatal()
    return
  }

  // Get time to pause before next retry
  const pause = (this.options.backoff || backoff)(this.attempt + 1, this)
  if (pause === false) {
    this.fatal()
    return
  }

  // Schedule retry
  this.log(`Scheduling retry in ${pause} ms`)

  this.waitTimer = setTimeout(() => {
    delete this.waitTimer
    this.start()
  }, pause)
}

/**
 * Called when transfer fails fatally.
 * Emits `error` event on output stream.
 * @returns {undefined}
 */
Transfer.prototype.fatal = function () {
  this.log('Transfer failed permanently', { id: this.id })

  const err = this.cancelled
    ? new errors.CancelError('Transfer cancelled')
    : new errors.TransferError(
      `Failed - Retries exhausted (${this.attempt}, ${this.attemptTotal} total)`
    )
  err.original = this.err
  this.stream.emit('error', err)
  this.stream.emit('end')
}

/**
 * Abort transfer.
 * @returns {undefined}
 */
Transfer.prototype.cancel = function () {
  // If already cancelled, ignore
  if (this.cancelled) return

  // Set cancelled flag
  this.cancelled = true

  this.log('Transfer cancelled', { id: this.id })

  // Cancel current action
  if (this.prePromise) {
    // pre function running - try to cancel it
    if (typeof this.prePromise.cancel == 'function') this.prePromise.cancel()
  } else if (this.req) {
    // Request in progress - abort it
    this.req.abort()
  } else if (this.waitTimer) {
    // Waiting to make new request - cancel timer and fail
    clearTimeout(this.waitTimer)
    delete this.waitTimer
    this.failed(new errors.CancelError('Transfer cancelled'), null, true)
  }
}

/**
 * Create short copy of transfer object with `.req`, `.res`, `.err` and `.stream` removed for logging
 * @returns {Object} - Short copy of transfer object
 */
Transfer.prototype.toJSON = function () {
  const out = Object.assign({}, this)
  delete out.req
  delete out.res
  delete out.err
  delete out.stream
  return out
}
