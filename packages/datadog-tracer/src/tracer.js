'use strict'

const { Sampler } = require('./sampler')
const { Writer } = require('./writer')
const { Span } = require('./span')
const { Config } = require('./config')
const { TextMapPropagator } = require('./propagators/text_map')
const { LogPropagator } = require('./propagators/log')

class Tracer {
  constructor (options) {
    const config = this.config = new Config(options)

    this._timer = undefined
    this._writer = new Writer(config)
    this._sampler = new Sampler(config)
    this._propagators = {
      text_map: new TextMapPropagator(config),
      log: new LogPropagator(config)
    }
  }

  configure (options) {
    this.config.update(options)
  }

  startSpan (name, options) {
    const span = new Span(this, name, options)

    span.trace.spans.push(span)

    return span
  }

  inject (span, format, carrier) {
    const propagator = this._propagators[format]

    if (!propagator) return

    this._sampler.sample(span)

    propagator.inject(span, carrier)
  }

  extract (format, carrier) {
    const propagator = this._propagators[format]

    if (!propagator) return null

    return propagator.extract(carrier)
  }

  process (span) {
    const trace = span.trace
    const flushInterval = this.config.flushInterval

    if (trace.started === trace.finished) {
      this._sampler.sample(span)
      this._writer.write(trace.spans)

      trace.spans = []

      if (this.config.flushInterval === 0) {
        this.flush()
      } else if (this.config.flushInterval > 0 && !this._timer) {
        this._timer = setTimeout(() => this.flush(), flushInterval).unref()
      }
    }
  }

  flush (done) {
    this._timer = clearTimeout(this._timer)
    this._writer.flush((err, res) => {
      if (!err && res.rate_by_service) {
        this._sampler.update(res.rate_by_service)
      }

      done && done()
    })
  }
}

const tracer = new Tracer()

process.once('beforeExit', () => tracer.flush())

module.exports = { tracer }