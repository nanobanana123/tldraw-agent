import express, { Request, Response } from 'express'
import * as functions from 'firebase-functions'
import { Readable } from 'stream'
import { AgentService } from '../../worker/do/AgentService'
import type { Environment } from '../../worker/environment'
import { knowledge } from '../../worker/routes/knowledge'
import { inspiration } from '../../worker/routes/inspiration'
import { analyzeImage } from '../../worker/routes/analyzeImage'

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

const app = express()
app.use(express.json({ limit: '5mb' }))

app.options('*', (_req, res) => {
	res.set(corsHeaders).status(204).end()
})

function buildEnv(): Environment {
	const configEnv = (functions.config().env ?? {}) as Record<string, string | undefined>
	return {
		OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? configEnv.openai_api_key ?? '',
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? configEnv.anthropic_api_key ?? '',
		GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? configEnv.google_api_key ?? '',
		AGENT_DURABLE_OBJECT: undefined as any, // not used in emulator
	}
}

app.post('/stream', async (req: Request, res: Response) => {
	res.set({
		...corsHeaders,
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
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
	} catch (error: any) {
		console.error('[firebase] stream failed', error)
		if (!closed) {
			const payload = `data: ${JSON.stringify({ error: error.message })}\n\n`
			res.write(payload)
		}
	} finally {
		if (!closed) {
			res.end()
		}
	}
})

app.get('/knowledge', async (req: Request, res: Response) => {
	await forwardResponse(res, await knowledge(toRequest(req), buildEnv()))
})

app.get('/inspiration', async (req: Request, res: Response) => {
	await forwardResponse(res, await inspiration(toRequest(req), buildEnv()))
})

app.post('/analyze-image', async (req: Request, res: Response) => {
	await forwardResponse(
		res,
		await analyzeImage(
			new Request(fullUrl(req), {
				method: 'POST',
				headers: req.headers as any,
				body: JSON.stringify(req.body),
			}),
			buildEnv()
		)
	)
})

function fullUrl(req: Request) {
	const protocol = req.protocol || 'http'
	const host = req.get('host') ?? 'localhost'
	return `${protocol}://${host}${req.originalUrl}`
}

function toRequest(req: Request) {
	return new Request(fullUrl(req), {
		method: req.method,
		headers: req.headers as any,
		body: req.method === 'GET' ? undefined : JSON.stringify(req.body),
	})
}

async function forwardResponse(res: Response, response: Response) {
	res.status(response.status)
	response.headers.forEach((value, key) => {
		res.setHeader(key, value)
	})
	res.set(corsHeaders)

	const body = response.body
	if (!body) {
		const text = await response.text()
		res.send(text)
		return
	}

	const readable = Readable.fromWeb(body as any)
	readable.on('error', (err) => {
		console.error('[firebase] response stream error', err)
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
