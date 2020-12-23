const { pipeline } = require('readable-stream')
const through2 = require('through2')
const Agent = require('agentkeepalive')
const got = require('got')
const errors = require('../errors')

// basically the same as regular request, but handles servers that do not support range headers
// it just omits all of the first request logic + skips until the byte we want is reached
const agent = {
  http: new Agent(),
  https: new Agent.HttpsAgent()
}
module.exports = (transfer) => {
  const skipTo = transfer.position
  transfer.cancelled = false
  const stream = got.stream(transfer.url, {
    ...transfer.gotOptions,
    agent
  })

  // When request made, record to transfer object
  // (so it can be cancelled if required)
  stream.once('request', (req) => {
    transfer.log('Sent HTTP request', { headers: req.headers })

    // Emit request event
    if (!transfer.req) transfer.stream.emit('request', req)

    // If transfer cancelled, abort request
    if (transfer.cancelled) req.abort()

    // Record req to transfer object
    transfer.req = req
  })

  // When response headers received, record to transfer object,
  // set length and check range headers correct
  stream.once('response', (res) => {
    transfer.log('Received HTTP response', {
      url: res.url,
      headers: res.headers
    })

    // Process response
    // Errors with e.g. range headers are emitted as errors
    try {
      // Check range headers match what requested
      const { headers } = res

      if (transfer.lastMod && headers['last-modified'] != transfer.lastMod) {
        throw new errors.TransferError(
          `Last modified date has changed: '${headers['last-modified']}' from '${transfer.lastMod}'`
        )
      }
      if (transfer.etag && headers.etag != transfer.etag) {
        throw new errors.TransferError(
          `ETag has changed: '${headers.etag}' from '${transfer.etag}'`
        )
      }
    } catch (err) {
      transfer.log('Response error', { err })
      transfer.cancelled = true
      transfer.req.abort(err)
      return
    }

    // Record res to transfer object
    transfer.res = res
  })

  // this is kept out of the finished handler
  // because we get more info here than there
  stream.once('error', (err, body, res) => {
    transfer.log('Stream error', { err, body })

    // Save error object to transfer
    err.res = res
    transfer.err = err
  })

  const skipToPosition = through2.obj((chunk, enc, cb) => {
    if (transfer.cancelled || transfer.err) return cb()
    if (skipToPosition.bytesSkipped >= skipTo) return cb(null, chunk) // we passed the point where we caught up, switch to passthrough

    // Increment count of bytes received
    skipToPosition.bytesSkipped += chunk.length
    if (skipToPosition.bytesSkipped <= skipTo) return cb() // ignore, not there yet

    // ok, we just got to the byte marker - cut it to the exact point and go
    cb(null, chunk.slice(skipToPosition.bytesSkipped - skipTo))
  })
  skipToPosition.bytesSkipped = 0

  const outStream = pipeline(stream, skipToPosition, (err) => {
    if (err) outStream.emit('error', err)
  })
  return outStream
}
