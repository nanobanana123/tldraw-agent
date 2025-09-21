import { IRequest } from 'itty-router'
import z from 'zod'
import { Environment } from '../environment'

const DEFAULT_GOOGLE_API_KEY = 'AIzaSyBcz2Nsm5_Avodoq2son1UTjTRoOiroNvM'

const GenerateImageRequestSchema = z.object({
	provider: z.literal('google-gemini').default('google-gemini'),
	mode: z.enum(['generate', 'edit']).default('generate'),
	prompt: z.string().min(1, 'prompt is required'),
	editPrompt: z.string().optional(),
	reference: z
		.object({
			base64: z.string().min(1, 'reference.base64 is required when provided'),
			mimeType: z.string().default('image/png'),
		})
		.nullable()
		.optional(),
	targetMimeType: z.string().optional(),
	maxOutputSize: z
		.object({
			width: z.number().positive().max(4096).optional(),
			height: z.number().positive().max(4096).optional(),
		})
		.optional(),
})

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...init.headers,
		},
	})
}

export async function generateImage(request: IRequest, env: Environment) {
	try {
		const parsed = GenerateImageRequestSchema.parse(await request.json())
		const suppliedKey = env.GOOGLE_API_KEY?.trim()
		const apiKey = suppliedKey ? suppliedKey : DEFAULT_GOOGLE_API_KEY

		if (!apiKey) {
			return jsonResponse(
				{
					error: 'Image generation is not configured. Missing Google API key.',
				},
				{ status: 500 }
			)
		}

		if (parsed.provider !== 'google-gemini') {
			return jsonResponse(
				{
					error: `Unsupported provider: ${parsed.provider}`,
				},
				{ status: 400 }
			)
		}

		if (parsed.mode === 'edit' && !parsed.reference) {
			return jsonResponse(
				{
					error: 'Edit requests must include `reference` image data.',
				},
				{ status: 400 }
			)
		}

		const modelId = 'gemini-2.5-flash-image-preview'
		const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`

		const parts: any[] = []
		const effectivePrompt = parsed.mode === 'edit' ? parsed.editPrompt ?? parsed.prompt : parsed.prompt

		if (parsed.mode === 'edit' && parsed.reference) {
			parts.push({ inlineData: { data: parsed.reference.base64, mimeType: parsed.reference.mimeType } })
		}

		parts.push({ text: effectivePrompt })

		const payload: Record<string, unknown> = {
			contents: [
				{
					role: 'user',
					parts,
				},
			],
		}

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey,
			},
			body: JSON.stringify(payload),
		})

		const result = await response.json<any>()

		if (!response.ok) {
			console.error('Gemini image generation error', result)
			const message = result?.error?.message ?? 'Image generation failed.'
			return jsonResponse({ error: message }, { status: response.status })
		}

		const partsResponse: any[] = result?.candidates?.[0]?.content?.parts ?? []
		const imagePart = partsResponse.find((part) => 'inlineData' in part)

		if (!imagePart?.inlineData?.data) {
			console.error('Gemini image response missing inline data', result)
			return jsonResponse(
				{ error: 'Image generation did not return inline image data.' },
				{ status: 502 }
			)
		}

		const responseMimeType = imagePart.inlineData.mimeType ?? parsed.targetMimeType ?? 'image/png'
		const dataUrl = `data:${responseMimeType};base64,${imagePart.inlineData.data}`

		return jsonResponse({ dataUrl })
	} catch (error) {
		console.error('Unexpected image generation error', error)
		if (error instanceof z.ZodError) {
			return jsonResponse({ error: error.message }, { status: 400 })
		}
		return jsonResponse({ error: 'Unexpected error generating image.' }, { status: 500 })
	}
}
