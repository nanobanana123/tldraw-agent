import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const DesignGuidanceAction = z
	.object({
		_type: z.literal('designGuidance'),
		recommendations: z.array(z.string().min(1)).min(1),
		notes: z.string().optional(),
	})
	.meta({
		title: 'Design guidance',
		description: 'Provide actionable creative recommendations.',
	})

type DesignGuidanceAction = z.infer<typeof DesignGuidanceAction>

export class DesignGuidanceActionUtil extends AgentActionUtil<DesignGuidanceAction> {
	static override type = 'designGuidance' as const

	override getSchema() {
		return DesignGuidanceAction
	}

	override getInfo(action: Streaming<DesignGuidanceAction>) {
		const bullets = action.recommendations
			.map((item, index) => `${index + 1}. ${item}`)
			.join('\n')
		const notes = action.notes ? `Notes: ${action.notes}` : ''
		return {
			icon: 'pencil' as const,
			description: `Design guidance:\n${bullets}${notes ? `\n${notes}` : ''}`,
			canGroup: () => false,
		}
	}

	override applyAction(_action: Streaming<DesignGuidanceAction>, _helpers: AgentHelpers) {
		// Guidance is purely informational; no additional side-effects required.
	}
}
