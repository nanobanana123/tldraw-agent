import { IRequest } from 'itty-router'
import { jsonResponse } from './utils/jsonResponse'

interface LexicaImage {
	id: string
	prompt: string
	src: string
	srcSmall: string
	srcTiny: string
	width: number
	height: number
}

interface LexicaResponse {
	images: LexicaImage[]
}

export async function inspiration(request: IRequest) {
	const url = new URL(request.url)
	const query = url.searchParams.get('q')?.trim()

	if (!query) {
		return jsonResponse({ error: 'Missing query parameter "q"' }, { status: 400 })
	}

	const lexicaUrl = `https://lexica.art/api/v1/search?q=${encodeURIComponent(query)}`
	const lexicaResponse = await fetch(lexicaUrl, {
		headers: { 'User-Agent': 'tldraw-agent/1.0 (inspiration lookup)' },
	})

	if (!lexicaResponse.ok) {
		return jsonResponse(
			{ error: `Inspiration provider returned ${lexicaResponse.status}` },
			{ status: 502 }
		)
	}

	const data = (await lexicaResponse.json()) as LexicaResponse
	const inspirations = (data.images ?? []).slice(0, 8).map((image) => ({
		id: image.id,
		prompt: image.prompt,
		thumbnail: image.srcSmall ?? image.srcTiny ?? image.src,
		src: image.src,
		width: image.width,
		height: image.height,
	}))

	return jsonResponse({ query, inspirations })
}
