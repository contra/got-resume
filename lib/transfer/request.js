const Agent = require('agentkeepalive')
const got = require('got')
const errors = require('../errors')

const agent = {
  http: new Agent(),
  https: new Agent.HttpsAgent()
}

const getRangeHeader = (headers) => {
  if (!headers['content-range']) {
    throw new errors.TransferError('No range header')
  }
  const range = headers['content-range'].match(/^bytes (\d+)-\d+\/(\d+)$/)
  if (!range) {
    throw new errors.TransferError(
      `Malformed range header '${headers['content-range']}'`
    )
  }
  return {
    start: range[1] != null ? parseInt(range[1]) : null,
    end: range[2] != null ? parseInt(range[2]) : null
  }
}

module.exports = (transfer) => {
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
    const first = !transfer.res
    try {
      // Check range headers match what requested
      // and set length from headers if not supplied in options.length
      const { headers } = res
      const supportsRanges = res.headers['accept-ranges'] === 'bytes'

      if (supportsRanges && transfer.position) {
        const range = getRangeHeader(headers)
        if (range.start != transfer.position) {
          throw new errors.TransferError(
            `Server returned wrong range '${range}', expected start at ${transfer.position}`
          )
        }

        if (first && transfer.length == null) transfer.length = range.end
      } else if (
        first &&
        transfer.length == null &&
        headers['content-length'] &&
        !headers['content-encoding']
      ) {
        transfer.length = headers['content-length'] * 1
      }

      // Record/check last modified date and/or eTag to ensure resource has not
      // changed between requests.
      if (first) {
        transfer.supportsRanges = supportsRanges
        transfer.lastMod = headers['last-modified']
        if (headers.etag) transfer.etag = headers.etag

        // Record total bytes to be transferred
        if (transfer.length != null) transfer.total = transfer.length

        // Emit progress event
        transfer.stream.emit('progress', {
          transferred: 0,
          total: transfer.total
        })
      } else {
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
      }
    } catch (err) {
      transfer.log('Response error', { err })
      transfer.cancelled = true
      transfer.req.abort(err)
      return
    }

    // Record res to transfer object
    transfer.res = res

    // Emit response event
    if (first) transfer.stream.emit('response', res)
  })

  // this is kept out of the finished handler
  // because we get more info here than there
  stream.once('error', (err, body, res) => {
    transfer.log('Stream error', { err, body })

    // Save error object to transfer
    err.res = res
    transfer.err = err
  })
  return stream
}
