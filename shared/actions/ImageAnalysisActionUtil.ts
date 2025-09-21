import { TLImageShape } from 'tldraw'
import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const ImageAnalysisAction = z
	.object({
		_type: z.literal('analyzeImage'),
		shapeId: z.string(),
		prompt: z.string().optional(),
	})
	.meta({
		title: 'Analyze image',
		description: 'Ask the assistant to analyze the selected image.',
	})

type ImageAnalysisAction = z.infer<typeof ImageAnalysisAction>

export class ImageAnalysisActionUtil extends AgentActionUtil<ImageAnalysisAction> {
	static override type = 'analyzeImage' as const

	override getSchema() {
		return ImageAnalysisAction
	}

	override getInfo(action: Streaming<ImageAnalysisAction>) {
		return {
			icon: 'eye' as const,
			description: action.complete
				? 'Analyzed selected image'
				: 'Analyzing selected image…',
			canGroup: () => false,
		}
	}

	override async applyAction(action: Streaming<ImageAnalysisAction>, helpers: AgentHelpers) {
		if (!action.complete) return
		if (!this.agent) return

		const editor = this.agent.editor
		const shape = editor.getShape<TLImageShape>(action.shapeId as any)
		if (!shape || shape.type !== 'image') {
			console.warn('[ImageAnalysisAction] Shape not found or not an image', action.shapeId)
			return
		}

		const asset = shape.props.assetId ? (editor.getAsset(shape.props.assetId) as any) : undefined
		const dataUrl = typeof asset?.props?.src === 'string' ? (asset.props.src as string) : null

		if (!dataUrl || !dataUrl.startsWith('data:image/')) {
			console.warn('[ImageAnalysisAction] Missing inline data for analysis')
			return
		}

		try {
			const response = await fetch('/analyze-image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dataUrl, prompt: action.prompt }),
			})

			if (!response.ok) {
				throw new Error(`Analyze route returned ${response.status}`)
			}

			const { description } = (await response.json()) as { description?: string }
			const message = description
				? `Image analysis results:\n${description}`
				: 'Image analysis returned no insights.'

			this.agent.schedule({ messages: [message] })
		} catch (error) {
			console.error('[ImageAnalysisAction] Failed', error)
			this.agent.schedule({
				messages: ['I was unable to analyze the selected image due to an error.'],
			})
		}

	}
}
