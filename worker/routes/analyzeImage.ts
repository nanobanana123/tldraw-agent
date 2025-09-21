import { jsonResponse } from './utils/jsonResponse'
import { Environment } from '../environment'

interface AnalyzePayload {
	dataUrl: string
	prompt?: string
}

const DEFAULT_PROMPT =
	'Provide a concise creative analysis focusing on subject, style, color palette, lighting, and notable details. Highlight elements that stand out and suggest potential directions for refinement.'

const DEFAULT_GOOGLE_KEY = 'AIzaSyBcz2Nsm5_Avodoq2son1UTjTRoOiroNvM'

export async function analyzeImage(request: Request, env: Environment): Promise<Response> {
	if (request.method !== 'POST') {
		return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
	}

	let body: AnalyzePayload
	try {
		body = await request.json()
	} catch (error) {
		return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
	}

	if (!body.dataUrl) {
		return jsonResponse({ error: 'Missing dataUrl' }, { status: 400 })
	}

	const match = body.dataUrl.match(/^data:(.*?);base64,(.*)$/)
	if (!match) {
		return jsonResponse({ error: 'dataUrl must be a base64-encoded image data URL' }, { status: 400 })
	}

	const [, mimeType, base64Data] = match
	const prompt = body.prompt?.trim() || DEFAULT_PROMPT

	const apiKey = env.GOOGLE_API_KEY?.trim() || DEFAULT_GOOGLE_KEY

	const geminiPayload = {
		contents: [
			{
				role: 'user' as const,
				parts: [
					{
						inlineData: {
							data: base64Data,
							mimeType,
						},
					},
					{ text: prompt },
				],
			},
		],
	}

	const response = await fetch(
		'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Goog-Api-Key': apiKey,
			},
			body: JSON.stringify(geminiPayload),
		}
	)

	if (!response.ok) {
		const errorBody = await response.text()
		return jsonResponse(
			{ error: 'Image analysis failed', details: errorBody },
			{ status: 502 }
		)
	}

	const result = await response.json()
	const candidates = result?.candidates ?? []
	const description = extractText(candidates) ?? 'No analysis available.'

	return jsonResponse({ description })
}

function extractText(candidates: any[]): string | null {
	for (const candidate of candidates) {
		const parts = candidate?.content?.parts ?? []
		for (const part of parts) {
			if (typeof part?.text === 'string' && part.text.trim()) {
				return part.text.trim()
			}
		}
	}
	return null
}
