const through2 = require('through2')

module.exports = (transfer, cancelAtLength) => {
  const out = through2((chunk, _, cb) => {
    // If transfer cancelled or error, discard incoming data
    // Solves https://github.com/overlookmotel/got-resume/issues/3
    if (transfer.cancelled || transfer.err) return cb()

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

    // Emit progress event
    transfer.stream.emit('progress', {
      transferred: chunkEnd,
      total: transfer.total
    })

    // If transfer complete, end stream and cancel request
    if (length != null && chunkEnd === length) {
      if (cancelAtLength) transfer.cancel()
    }

    // Done
    cb(null, chunk)
  })
  out.received = 0
  return out
}
