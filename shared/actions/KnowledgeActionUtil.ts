import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const KnowledgeAction = z
	.object({
		_type: z.literal('knowledge'),
		query: z.string().min(1),
	})
	.meta({
		title: 'Knowledge lookup',
		description: 'Fetch up-to-date background information to support the task.',
	})

type KnowledgeAction = z.infer<typeof KnowledgeAction>

interface KnowledgeResult {
	summary?: string
	heading?: string
	related?: { text: string; url?: string }[]
	sourceUrl?: string
}

export class KnowledgeActionUtil extends AgentActionUtil<KnowledgeAction> {
	static override type = 'knowledge' as const

	override getSchema() {
		return KnowledgeAction
	}

	override getInfo(action: Streaming<KnowledgeAction>) {
		const description = action.complete
			? `Knowledge lookup: ${action.query}`
			: `Looking up: ${action.query}`
		return {
			icon: 'search' as const,
			description,
			canGroup: () => false,
		}
	}

	override async applyAction(action: Streaming<KnowledgeAction>, helpers: AgentHelpers) {
		if (!action.complete) return
		if (!this.agent) return

		try {
			const response = await fetch(`/knowledge?q=${encodeURIComponent(action.query)}`)
			if (!response.ok) {
				throw new Error(`Knowledge route returned ${response.status}`)
			}
			const result = (await response.json()) as KnowledgeResult

			const summary = result.summary?.trim()
			const heading = result.heading ?? action.query
			const message = summary
				? `Knowledge findings for "${heading}":\n${summary}`
				: `No relevant knowledge found for "${heading}".`

			const details = {
				type: 'knowledge' as const,
				query: action.query,
				heading,
				summary,
				sourceUrl: result.sourceUrl,
				related: result.related,
			}

			this.agent.schedule({ messages: [message], data: [details] })
		} catch (error) {
			console.error('[KnowledgeAction] Failed', error)
			this.agent.schedule({
				messages: [
					`I tried to look up "${action.query}" but the request failed. I'll continue with the available information.`,
				],
			})
		}

		helpers.observeMessageForImageFollowup(action.query)
	}
}
