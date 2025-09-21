import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const InspirationAction = z
	.object({
		_type: z.literal('inspiration'),
		query: z.string().min(1),
	})
	.meta({
		title: 'Inspiration search',
		description: 'Gather visual inspiration references.',
	})

type InspirationAction = z.infer<typeof InspirationAction>

interface InspirationResult {
	query: string
	inspirations: InspirationItem[]
}

interface InspirationItem {
	id: string
	prompt: string
	thumbnail: string
	src: string
	width: number
	height: number
}

export class InspirationActionUtil extends AgentActionUtil<InspirationAction> {
	static override type = 'inspiration' as const

	override getSchema() {
		return InspirationAction
	}

	override getInfo(action: Streaming<InspirationAction>) {
		const description = action.complete
			? `Collected inspiration: ${action.query}`
			: `Searching inspiration: ${action.query}`
		return {
			icon: 'eye' as const,
			description,
			canGroup: () => false,
		}
	}

	override async applyAction(action: Streaming<InspirationAction>, helpers: AgentHelpers) {
		if (!action.complete) return
		if (!this.agent) return

		try {
			const response = await fetch(`/inspiration?q=${encodeURIComponent(action.query)}`)
			if (!response.ok) {
				throw new Error(`Inspiration route returned ${response.status}`)
			}
			const result = (await response.json()) as InspirationResult

			const items = result.inspirations ?? []
			const message = items.length
				? `Collected ${items.length} inspiration reference${items.length === 1 ? '' : 's'} for "${action.query}".`
				: `No inspiration references found for "${action.query}".`

			this.agent.schedule({ messages: [message], data: [result] })
		} catch (error) {
			console.error('[InspirationAction] Failed', error)
			this.agent.schedule({
				messages: [
					`I tried to find inspiration for "${action.query}" but the request failed. I'll continue with the current references.`,
				],
			})
		}

		helpers.observeMessageForImageFollowup(action.query)
	}
}
