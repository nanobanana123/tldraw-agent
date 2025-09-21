import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImage } from '../worker/routes/images'
import type { Environment } from '../worker/environment'

const DEFAULT_KEY = 'AIzaSyBcz2Nsm5_Avodoq2son1UTjTRoOiroNvM'

function createRequest(body: unknown) {
	return new Request('https://example.com/images/generate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}) as unknown as Request
}

describe('generateImage route', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('sends request to Gemini and returns dataUrl', async () => {
		const mockResponse = {
			candidates: [
				{
					content: {
						parts: [
							{
								inlineData: {
									data: 'BASE64DATA',
									mimeType: 'image/png',
								},
							},
						],
					},
				},
			],
		}

		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)

		const env = {
			GOOGLE_API_KEY: 'custom-key',
			ANTHROPIC_API_KEY: '',
			OPENAI_API_KEY: '',
			AGENT_DURABLE_OBJECT: {} as any,
		} satisfies Environment

		const request = createRequest({
			provider: 'google-gemini',
			mode: 'generate',
			prompt: 'Generate a banana',
		})

		const response = await generateImage(request as any, env)
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.dataUrl).toBe('data:image/png;base64,BASE64DATA')

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const [, options] = fetchSpy.mock.calls[0]
		expect(options && typeof options === 'object' && 'headers' in options ? (options as any).headers['x-goog-api-key'] : undefined).toBe('custom-key')
	})

	it('falls back to default key when env key missing', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					candidates: [
						{ content: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'image/png' } }] } },
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		)

		const env = {
			GOOGLE_API_KEY: '',
			ANTHROPIC_API_KEY: '',
			OPENAI_API_KEY: '',
			AGENT_DURABLE_OBJECT: {} as any,
		} satisfies Environment

		const response = await generateImage(
			createRequest({ provider: 'google-gemini', prompt: 'banana' }) as any,
			env
		)

		const [, options] = fetchSpy.mock.calls[0]
		expect(options.headers['x-goog-api-key']).toBe(DEFAULT_KEY)

		expect(response.status).toBe(200)
	})

	it('propagates Gemini error message', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ error: { message: 'bad prompt' } }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			})
		)

		const env = {
			GOOGLE_API_KEY: 'key',
			ANTHROPIC_API_KEY: '',
			OPENAI_API_KEY: '',
			AGENT_DURABLE_OBJECT: {} as any,
		} satisfies Environment

		const res = await generateImage(
			createRequest({ provider: 'google-gemini', prompt: 'invalid' }) as any,
			env
		)

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.error).toBe('bad prompt')
	})
})
