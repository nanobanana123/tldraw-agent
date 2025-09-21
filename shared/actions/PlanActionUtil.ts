import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const PlanAction = z
	.object({
		_type: z.literal('plan'),
		steps: z.array(z.string().min(1)).min(1),
		objective: z.string().optional(),
	})
	.meta({
		title: 'Smart Plan',
		description: 'Outline the plan before executing a complex task.',
	})

type PlanAction = z.infer<typeof PlanAction>

export class PlanActionUtil extends AgentActionUtil<PlanAction> {
	static override type = 'plan' as const

	override getSchema() {
		return PlanAction
	}

	override getInfo(action: Streaming<PlanAction>) {
		if (!action.steps?.length) {
			return { description: 'Planning next steps…', icon: 'note' as const }
		}

		const bulletList = action.steps
			.map((step, index) => `${index + 1}. ${step}`)
			.join('\n')

		const header = action.objective ? `Objective: ${action.objective}\n` : ''

		return {
			icon: 'note' as const,
			description: `${header}Smart plan:\n${bulletList}`,
			canGroup: () => false,
		}
	}

	override applyAction(_action: Streaming<PlanAction>, _helpers: AgentHelpers) {
		// No-op. The plan is recorded in chat history for transparency.
	}
}
