const through2 = require('through2')

module.exports = (transfer) => {
  const out = through2(function (chunk, _, cb) {
    // If transfer aborted or error, discard incoming data
    // Solves https://github.com/overlookmotel/got-resume/issues/3
    if (transfer.aborted || transfer.err) return cb()

    // Increment count of bytes received
    out.received += chunk.length

    // If entire chunk is before range required, discard chunk
    const {
      length
    } = transfer
    let chunkEnd = transfer.position + chunk.length

    if (length != null && chunkEnd > length) {
      chunk = chunk.slice(0, length - transfer.position)
      chunkEnd = length
    }

    // Output chunk + update position
    transfer.position = chunkEnd
    if (chunk.length) this.push(chunk)

    // Emit progress event
    transfer.stream.emit('progress', {
      transferred: chunkEnd,
      total: transfer.total
    })

    // If transfer complete, end stream and cancel request
    if (length != null && chunkEnd === length) {
      this.push(null)
      if (transfer.req) transfer.req.abort()
    }

    // Done
    cb()
  })
  out.received = 0
  return out
}
