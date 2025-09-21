const functions = require('firebase-functions')
const express = require('express')
const { Readable } = require('stream')

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    target: 'ES2020'
  }
})

const { AgentService } = require('../worker/do/AgentService')
const { knowledge } = require('../worker/routes/knowledge')
const { inspiration } = require('../worker/routes/inspiration')
const { analyzeImage } = require('../worker/routes/analyzeImage')

const app = express()
app.use(express.json({ limit: '5mb' }))

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
}

app.options('*', (_req, res) => {
  res.set(corsHeaders).status(204).end()
})

function buildEnv() {
  const configEnv = functions.config().env || {}
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || configEnv.openai_api_key,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || configEnv.anthropic_api_key,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || configEnv.google_api_key
  }
}

app.post('/stream', async (req, res) => {
  res.set({
    ...corsHeaders,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })

  const env = buildEnv()
  const service = new AgentService(env)

  let closed = false

  req.on('close', () => {
    closed = true
    res.end()
  })

  try {
    for await (const change of service.stream(req.body)) {
      if (closed) break
      const payload = `data: ${JSON.stringify(change)}\n\n`
      res.write(payload)
    }
    if (!closed) {
      res.end()
    }
  } catch (error) {
    console.error('[firebase] stream failed', error)
    if (!closed) {
      const payload = `data: ${JSON.stringify({ error: error.message })}\n\n`
      res.write(payload)
      res.end()
    }
  }
})

app.get('/knowledge', async (req, res) => {
  try {
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: 'GET',
      headers: new Headers(req.headers)
    })
    const response = await knowledge(request, buildEnv())
    await forwardResponse(res, response)
  } catch (error) {
    console.error('[firebase] knowledge failed', error)
    res.set(corsHeaders).status(500).json({ error: 'Knowledge lookup failed' })
  }
})

app.get('/inspiration', async (req, res) => {
  try {
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: 'GET',
      headers: new Headers(req.headers)
    })
    const response = await inspiration(request, buildEnv())
    await forwardResponse(res, response)
  } catch (error) {
    console.error('[firebase] inspiration failed', error)
    res.set(corsHeaders).status(500).json({ error: 'Inspiration lookup failed' })
  }
})

app.post('/analyze-image', async (req, res) => {
  try {
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json', ...req.headers }),
      body: JSON.stringify(req.body)
    })
    const response = await analyzeImage(request, buildEnv())
    await forwardResponse(res, response)
  } catch (error) {
    console.error('[firebase] analyze-image failed', error)
    res.set(corsHeaders).status(500).json({ error: 'Image analysis failed' })
  }
})

async function forwardResponse(res, response) {
  res.status(response.status)
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.set(corsHeaders)
  if (!response.body) {
    const text = await response.text()
    res.send(text)
    return
  }
  const readable = Readable.fromWeb(response.body)
  readable.on('error', (err) => {
    console.error('[firebase] stream pipe error', err)
    if (!res.headersSent) {
      res.status(500)
    }
    res.end()
  })
  readable.pipe(res)
}

exports.tldrawAgent = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .https.onRequest(app)
