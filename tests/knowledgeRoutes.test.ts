import { afterEach, describe, expect, it, vi } from 'vitest'
import { knowledge } from '../worker/routes/knowledge'
import { inspiration } from '../worker/routes/inspiration'
import { analyzeImage } from '../worker/routes/analyzeImage'
import type { Environment } from '../worker/environment'

const REQUEST_BASE = 'https://example.com'

function makeRequest(path: string): Request {
	return new Request(`${REQUEST_BASE}${path}`)
}

describe('creative helper routes', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns knowledge summary', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					Heading: 'Ramen',
					AbstractText: 'Ramen is a Japanese noodle soup.',
					AbstractURL: 'https://example.com/ramen',
					RelatedTopics: [
						{ Text: 'Tonkotsu ramen is rich and creamy.' },
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		)

		const res = await knowledge(makeRequest('/knowledge?q=ramen') as any)
		const body = await res.json()

		expect(res.status).toBe(200)
		expect(body.summary).toContain('Japanese noodle soup')
		expect(body.related).toHaveLength(1)
	})

	it('returns inspiration images', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					images: [
						{
							id: 'img-1',
							prompt: 'Stylish ramen bowl',
							src: 'https://images.test/large.jpg',
							srcSmall: 'https://images.test/small.jpg',
							srcTiny: 'https://images.test/tiny.jpg',
							width: 512,
							height: 512,
						},
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		)

		const res = await inspiration(makeRequest('/inspiration?q=ramen') as any)
		const body = await res.json()

		expect(res.status).toBe(200)
		expect(body.inspirations).toHaveLength(1)
		expect(body.inspirations[0].thumbnail).toContain('small')
	})

	it('analyzes image via Gemini', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [{ text: 'A descriptive analysis of the ramen photo.' }],
							},
						},
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		)

		const env = {
			OPENAI_API_KEY: '',
			ANTHROPIC_API_KEY: '',
			GOOGLE_API_KEY: 'test-key',
			AGENT_DURABLE_OBJECT: {} as any,
	} satisfies Environment

		const dataUrl = 'data:image/png;base64,AAA='
		const res = await analyzeImage(
			new Request(`${REQUEST_BASE}/analyze-image`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dataUrl }),
			}),
			env
		)

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.description).toContain('ramen')
	})
})
