import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const DesignDirectionAction = z
	.object({
		_type: z.literal('designDirection'),
		title: z.string().optional(),
		summary: z.string().min(1),
		pillars: z.array(z.string().min(1)).optional(),
	})
	.meta({
		title: 'Design direction',
		description: 'Communicate a high-level creative direction.',
	})

type DesignDirectionAction = z.infer<typeof DesignDirectionAction>

export class DesignDirectionActionUtil extends AgentActionUtil<DesignDirectionAction> {
	static override type = 'designDirection' as const

	override getSchema() {
		return DesignDirectionAction
	}

	override getInfo(action: Streaming<DesignDirectionAction>) {
		const header = action.title ? `Design direction • ${action.title}` : 'Design direction'
		const pillars = (action.pillars ?? []).map((pillar) => `• ${pillar}`).join('\n')
		const descriptionLines = [header, action.summary, pillars].filter(Boolean)
		return {
			icon: 'target' as const,
			description: descriptionLines.join('\n'),
			canGroup: () => false,
		}
	}

	override applyAction(_action: Streaming<DesignDirectionAction>, _helpers: AgentHelpers) {
		// No side-effects required; the info is captured in chat history for review.
	}
}
