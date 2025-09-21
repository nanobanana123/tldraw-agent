import { IRequest } from 'itty-router'
import { jsonResponse } from './utils/jsonResponse'

const DUCK_API = 'https://api.duckduckgo.com/'

interface DuckDuckGoResponse {
	Abstract?: string
	AbstractText?: string
	Heading?: string
	AbstractURL?: string
	RelatedTopics?: Array<{
		Text?: string
		FirstURL?: string
		Topics?: Array<{ Text?: string; FirstURL?: string }>
	}>
	Image?: string
}

export async function knowledge(request: IRequest) {
	const url = new URL(request.url)
	const query = url.searchParams.get('q')?.trim()

	if (!query) {
		return jsonResponse({ error: 'Missing query parameter "q"' }, { status: 400 })
	}

	const ddgUrl = `${DUCK_API}?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`
	const ddgResponse = await fetch(ddgUrl, {
		headers: { 'User-Agent': 'tldraw-agent/1.0 (knowledge lookup)' },
	})

	if (!ddgResponse.ok) {
		return jsonResponse(
			{ error: `Knowledge provider returned ${ddgResponse.status}` },
			{ status: 502 }
		)
	}

	const data = (await ddgResponse.json()) as DuckDuckGoResponse

	const abstract = data.AbstractText || data.Abstract || ''
	const heading = data.Heading || query

	const related: { text: string; url?: string }[] = []
	for (const topic of data.RelatedTopics ?? []) {
		if (topic.Text) {
			related.push({ text: topic.Text, url: topic.FirstURL })
		}
		if (topic.Topics) {
			for (const sub of topic.Topics) {
				if (sub.Text) {
					related.push({ text: sub.Text, url: sub.FirstURL })
				}
			}
		}
	}

	const summary = abstract || (related.length ? related[0].text : '') || `No summary found for "${query}".`

	return jsonResponse({
		query,
		heading,
		summary,
		sourceUrl: data.AbstractURL,
		related: related.slice(0, 10),
	})
}
