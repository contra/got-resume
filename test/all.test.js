const gotResume = require('../lib')

const URL_PREFIX =
  'https://raw.githubusercontent.com/overlookmotel/got-resume/master/test/files/'

describe('Tests', () => {
  describe('Streams', () => {
    it('empty file', (done) => {
      const stream = gotResume(`${URL_PREFIX}empty.txt`)

      let count = 0, err
      stream.on('data', () => count++)
      stream.on('end', () => {
        if (err) return
        if (count) return done(new Error('No data should have been received'))
        done()
      })
      stream.on('error', (_err) => {
        err = _err
        done(err)
      })
    })

    it('short file', (done) => {
      const stream = gotResume(`${URL_PREFIX}short.txt`)

      let out = '', err
      stream.on('data', (data) => {
        out += data.toString()
      })
      stream.on('end', () => {
        if (err) return
        if (out != 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          return done(new Error('Bad data received'))
        }
        done()
      })
      stream.on('error', (_err) => {
        err = _err
        done(err)
      })
    })
  })
})
