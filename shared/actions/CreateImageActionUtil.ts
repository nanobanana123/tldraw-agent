import { TLAsset, TLImageAsset, TLImageShape, TLShapeId } from 'tldraw'
import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const CreateImageGenerator = z.object({
	provider: z.literal('google-gemini').default('google-gemini'),
	mode: z.enum(['generate', 'edit']).default('generate'),
	prompt: z.string().min(1, 'prompt is required when requesting image generation'),
	editPrompt: z.string().optional(),
	referenceShapeId: z.string().optional(),
	referenceAssetId: z.string().optional(),
	mimeType: z
		.string()
		.optional(),
	targetMimeType: z
		.string()
		.optional(),
	maxOutputSize: z
		.object({
			width: z.number().positive().max(4096).optional(),
			height: z.number().positive().max(4096).optional(),
		})
		.optional(),
})
	.describe(
		'Instructs the runtime to call Gemini directly when `dataUrl` is omitted. Provide `prompt` and set `mode` to `edit` when modifying an existing image. For edits, include `referenceShapeId` (and optionally `referenceAssetId`) pointing at the current image.'
	)

const Base64Image = z
	.string()
	.regex(/^data:image\//, 'dataUrl must be a base64-encoded image data URL')
	.describe('A full data URL (including `data:image/...;base64,` prefix).')

const CreateImageAction = z
	.object({
		_type: z.literal('createImage'),
		intent: z.string(),
		shapeId: z.string(),
		dataUrl: Base64Image.optional(),
		generator: CreateImageGenerator.optional(),
		x: z.number(),
		y: z.number(),
		w: z.number().positive().optional(),
		h: z.number().positive().optional(),
		altText: z.string().optional(),
	})
	.superRefine((value, ctx) => {
		if (!value.dataUrl && !value.generator) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide either `dataUrl` or a `generator` description so the runtime can obtain image bytes.',
				path: ['dataUrl'],
			})
		}
		if (value.generator && value.generator.mode === 'edit') {
			const shapeRef = value.generator.referenceShapeId ?? value.generator.referenceAssetId
			if (!shapeRef) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Edits must specify `referenceShapeId` or `referenceAssetId` so the runtime can fetch the source image.',
					path: ['generator', 'referenceShapeId'],
				})
			}
		}
	})
	.meta({
		title: 'Create Image',
		description:
			'The AI generates or edits a raster image (for example via an external image model) and places it on the canvas as an image shape. For large files, prefer specifying a `generator` instead of embedding the full base64 payload.',
	})

type CreateImageAction = z.infer<typeof CreateImageAction>
type CreateImageGeneratorConfig = z.infer<typeof CreateImageGenerator>

export class CreateImageActionUtil extends AgentActionUtil<CreateImageAction> {
	static override type = 'createImage' as const

	override getSchema() {
		return CreateImageAction
	}

	override getInfo(action: Streaming<CreateImageAction>) {
		const preview =
			action.complete && action.dataUrl
				? {
					dataUrl: action.dataUrl,
					altText: action.altText ?? '',
				}
				: action.complete
					? this.resolvePreviewFromCanvas(action)
					: undefined

		return {
			icon: 'note' as const,
			description: action.intent ?? '',
			imagePreview: preview,
		}
	}

	private resolvePreviewFromCanvas(
		action: Streaming<CreateImageAction>
	): { dataUrl: string; altText: string } | undefined {
		if (!this.agent) return undefined
		const { editor } = this.agent
		const shapeId = action.shapeId.startsWith('shape:')
			? (action.shapeId as TLShapeId)
			: (`shape:${action.shapeId}` as TLShapeId)
		const shape = editor.getShape<TLImageShape>(shapeId)
		if (!shape || shape.type !== 'image') return undefined
		const assetId = shape.props.assetId
		if (!assetId) return undefined
		const asset = editor.getAsset(assetId) as TLImageAsset | undefined
		const src = asset?.props.src
		if (!src || typeof src !== 'string' || !src.startsWith('data:image/')) return undefined
		return {
			dataUrl: src,
			altText: action.altText ?? '',
		}
	}

	override sanitizeAction(action: Streaming<CreateImageAction>, helpers: AgentHelpers) {
		if (!action.complete) return action

		const { shapeId } = action
		action.shapeId = helpers.ensureShapeIdIsUnique(action.shapeId)
		if (shapeId !== action.shapeId) {
			console.info(
				'[CreateImageAction] Remapped incoming shape id to ensure uniqueness',
				{ originalId: shapeId, sanitizedId: action.shapeId }
			)
		}
		return action
	}

	override async applyAction(action: Streaming<CreateImageAction>, helpers: AgentHelpers) {
		if (!action.complete) return
		if (!this.agent) return

		const { editor } = this.agent

		const shapeId = action.shapeId.startsWith('shape:')
			? (action.shapeId as TLShapeId)
			: (`shape:${action.shapeId}` as TLShapeId)

		const position = helpers.removeOffsetFromVec({ x: action.x, y: action.y })

		const generator = action.generator
		let resolvedDataUrl = action.dataUrl

		console.info('[CreateImageAction] Creating image', {
			shapeId,
			intent: action.intent,
			altText: action.altText,
			hasInlineData: Boolean(action.dataUrl),
			hasGenerator: Boolean(generator),
		})

		if (!resolvedDataUrl && generator) {
			const fetched = await this.fetchImageFromGenerator({
				action,
				generator,
				helpers,
			})
			if (!fetched) {
				console.warn('[CreateImageAction] Generator request failed; aborting image creation', {
					shapeId,
				})
				return
			}
			resolvedDataUrl = fetched.dataUrl
			if (!action.dataUrl) {
				// Ensure history previews can use the generated data
				;(action as CreateImageAction).dataUrl = resolvedDataUrl
			}

			if (fetched.width && !action.w) {
				(action as CreateImageAction).w = fetched.width
			}
			if (fetched.height && !action.h) {
				(action as CreateImageAction).h = fetched.height
			}
		}

		if (!resolvedDataUrl) {
			console.warn('[CreateImageAction] No image data or generator result provided', {
				shapeId,
			})
			helpers.scheduleImageRetry(
				'The generated image data was missing. Please resend using a `createImage` action that either includes a base64 `dataUrl` or a valid `generator` description.'
			)
			return
		}

		let blob: Blob
		try {
			console.debug('[CreateImageAction] Fetching data URL')
			const response = await fetch(resolvedDataUrl)
			blob = await response.blob()
			console.debug('[CreateImageAction] Data URL fetched', {
				mimeType: blob.type,
				size: blob.size,
			})
			if (!blob.size) {
				console.warn('[CreateImageAction] Received empty image blob, aborting createImage', { shapeId })
				helpers.scheduleImageRetry(
					'The generated image data was empty. Please resend the image as a `createImage` action with a valid base64 `dataUrl`.'
				)
				return
			}
		} catch (error) {
			console.error('Failed to fetch image data URL', error)
			helpers.scheduleImageRetry(
				'There was an error downloading the generated image. Please resend it as a `createImage` action with a base64 `dataUrl`.'
			)
			return
		}

		let measuredWidth = action.w
		let measuredHeight = action.h
		try {
			const { width, height } = await getImageDimensions(blob, {
				width: measuredWidth,
				height: measuredHeight,
			})
			console.debug('[CreateImageAction] Measured image dimensions', { width, height })
			if (!measuredWidth) measuredWidth = width
			if (!measuredHeight) measuredHeight = height
			if (!measuredWidth || !measuredHeight || measuredWidth === 0 || measuredHeight === 0) {
				throw new Error('Measured zero dimensions')
			}
		} catch (dimensionError) {
			console.warn('[CreateImageAction] Failed to determine image dimensions', dimensionError)
			helpers.scheduleImageRetry(
				'Could not determine the size of the generated image. Please resend it with a valid base64 `dataUrl`.'
			)
			return
		}

		const mimeType = blob.type || generator?.targetMimeType || 'image/png'
		const fileExtension = mimeType.split('/')[1] || 'png'
		const fileName = `agent-image-${Date.now()}.${fileExtension}`
		const file = new File([blob], fileName, { type: mimeType })

		let asset: TLAsset | undefined
		try {
			console.debug('[CreateImageAction] Requesting asset for generated image', {
				mimeType,
				fileName,
			})
			asset = await editor.getAssetForExternalContent({ type: 'file', file })
			console.debug('[CreateImageAction] Asset obtained', { assetId: asset?.id })
		} catch (error) {
			console.error('Failed to create image asset', error)
			helpers.scheduleImageRetry(
				'The generated image could not be processed. Please resend it as a `createImage` action with a base64 `dataUrl`.'
			)
			return
		}

		if (!asset || asset.type !== 'image') {
		console.error('Asset returned is not an image asset', asset)
		helpers.scheduleImageRetry(
			'The generated image asset was invalid. Please resend the image using a `createImage` action and include the base64 `dataUrl`.'
		)
		return
	}

	const assetWidth = measuredWidth ?? (asset as TLImageAsset).props.w ?? 512
	const assetHeight = measuredHeight ?? (asset as TLImageAsset).props.h ?? 512

	const imageAsset: TLImageAsset = {
		...(asset as TLImageAsset),
		type: 'image',
		props: {
			...(asset as TLImageAsset).props,
			w: assetWidth,
			h: assetHeight,
			mimeType,
			name: fileName,
			src: action.dataUrl,
		},
	}


		const assetSrcSample = typeof imageAsset.props.src === 'string' ? imageAsset.props.src.slice(0, 64) : imageAsset.props.src
		console.debug('[CreateImageAction] Asset props sample', { src: assetSrcSample })

		const width = imageAsset.props.w ?? 512
		const height = imageAsset.props.h ?? 512
		if (!width || !height) {
			console.warn('[CreateImageAction] Image dimensions unresolved, aborting createImage', {
				width,
				height,
			})
			helpers.scheduleImageRetry(
				'The generated image dimensions were invalid. Please resend the image using a `createImage` action with a proper base64 `dataUrl`.'
			)
			return
		}
		if (width <= 1 && height <= 1) {
			console.warn('[CreateImageAction] Image dimensions appear blank (<=1px). Rendering anyway for debug visibility.', {
				width,
				height,
			})
		}

		editor.run(() => {
			console.debug('[CreateImageAction] Committing image asset and shape', {
				assetId: imageAsset.id,
				shapeId,
				dimensions: { width, height },
			})
			if (!editor.getAsset(imageAsset.id)) {
				editor.createAssets([imageAsset])
			}

			editor.createShape<TLImageShape>({
				id: shapeId,
				type: 'image',
				typeName: 'shape',
				opacity: 1,
				x: position.x,
				y: position.y,
				rotation: 0,
				props: {
					assetId: imageAsset.id,
					w: width,
					h: height,
					url: '',
					crop: null,
					playing: false,
					flipX: false,
					flipY: false,
					altText: action.altText ?? '',
				},
			})
		})

		const createdShape = editor.getShape<TLImageShape>(shapeId)
		console.debug('[CreateImageAction] Created image shape props', createdShape?.props)

		let resolvedUrl: string | null = null
		console.info('[CreateImageAction] Image shape created successfully', {
			shapeId,
			altText: action.altText,
			assetId: imageAsset.id,
			previewSrc: (imageAsset.props.src ?? '').slice(0, 64),
			urlSample: resolvedUrl ?? action.dataUrl.slice(0, 64),
			dimensions: { width, height },
		})
		helpers.markImageCreated()
	}

	private async fetchImageFromGenerator({
		action,
		generator,
		helpers,
	}: {
		action: Streaming<CreateImageAction>
		generator: CreateImageGeneratorConfig
		helpers: AgentHelpers
	}): Promise<{ dataUrl: string; width?: number; height?: number } | null> {
		if (!this.agent) return null
		const { editor } = this.agent

		const mode = generator.mode ?? 'generate'
		const prompt = generator.prompt || action.intent
		const editPrompt = generator.editPrompt ?? (mode === 'edit' ? action.intent : undefined)

		let reference: { base64: string; mimeType: string } | null = null

		if (mode === 'edit') {
			const referenceDescriptor = generator.referenceAssetId ?? generator.referenceShapeId
			if (!referenceDescriptor) {
				console.warn('[CreateImageAction] Generator missing reference for edit request')
				helpers.scheduleImageRetry(
					'The edit request did not specify which image to modify. Please resend the `createImage` action with `generator.referenceShapeId` pointing to the existing image.'
				)
				return null
			}

			let asset: TLImageAsset | undefined
			if (referenceDescriptor.startsWith('asset:')) {
				asset = editor.getAsset(referenceDescriptor as any) as TLImageAsset | undefined
			} else {
				const resolvedShapeId = referenceDescriptor.startsWith('shape:')
					? (referenceDescriptor as TLShapeId)
					: (`shape:${referenceDescriptor}` as TLShapeId)
				const shape = editor.getShape<TLImageShape>(resolvedShapeId)
				if (!shape || shape.type !== 'image') {
					console.warn('[CreateImageAction] Reference shape for edit not found or not an image', {
						referenceDescriptor,
					})
					helpers.scheduleImageRetry(
						"Couldn't locate the image to edit. Please resend the `createImage` action with a valid `referenceShapeId`."
					)
					return null
				}
				const assetId = shape.props.assetId
				asset = assetId ? (editor.getAsset(assetId) as TLImageAsset | undefined) : undefined
			}

			if (!asset || !asset.props) {
				console.warn('[CreateImageAction] Unable to load asset for edit request', {
					referenceDescriptor,
				})
				helpers.scheduleImageRetry(
					"Couldn't retrieve the original image. Please resend the request after ensuring the image still exists."
				)
				return null
			}

			const src = asset.props.src
			if (!src || typeof src !== 'string' || !src.startsWith('data:image/')) {
				console.warn('[CreateImageAction] Asset does not contain an inline data URL', {
					referenceDescriptor,
				})
				helpers.scheduleImageRetry(
					'The runtime could not read the original image data. Please resend the edit request including an inline base64 `dataUrl`.'
				)
				return null
			}

			const base64 = src.includes(',') ? src.slice(src.indexOf(',') + 1) : src
			reference = {
				base64,
				mimeType: asset.props.mimeType ?? generator.mimeType ?? 'image/png',
			}
		}

		try {
			const requestBody = {
				provider: generator.provider,
				mode,
				prompt,
				editPrompt,
				reference,
				targetMimeType: generator.targetMimeType,
				maxOutputSize: generator.maxOutputSize,
			}

			console.debug('[CreateImageAction] Requesting image via generator', {
				prompt,
				mode,
				hasReference: Boolean(reference),
			})

			const response = await fetch('/images/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const text = await response.text()
				console.error('[CreateImageAction] Image generator request failed', {
					status: response.status,
					statusText: response.statusText,
					body: text,
				})
				helpers.scheduleImageRetry(
					'The image service returned an error. Please try again with a simpler description or different edit instructions.'
				)
				return null
			}

			const result = (await response.json()) as {
				dataUrl?: string
				width?: number
				height?: number
				error?: string
			}

			if (result?.error) {
				console.error('[CreateImageAction] Image generator reported error', result)
				helpers.scheduleImageRetry(result.error)
				return null
			}

			if (!result?.dataUrl) {
				console.warn('[CreateImageAction] Image generator returned no dataUrl')
				helpers.scheduleImageRetry(
					'The image service returned an empty response. Please reissue the request with clear generation instructions.'
				)
				return null
			}

			return {
				dataUrl: result.dataUrl,
				width: result.width,
				height: result.height,
			}
		} catch (error) {
			console.error('[CreateImageAction] Failed to call image generator', error)
			helpers.scheduleImageRetry(
				'The image generator could not be reached. Please try again shortly.'
			)
			return null
		}
	}
}

async function getImageDimensions(
	blob: Blob,
	fallback?: { width?: number; height?: number }
): Promise<{ width: number; height: number }> {
	if (typeof createImageBitmap === 'function') {
		try {
			const bitmap = await createImageBitmap(blob)
			return { width: bitmap.width, height: bitmap.height }
		} catch (error) {
			console.warn('[CreateImageAction] createImageBitmap failed, falling back to HTMLImageElement', error)
		}
	}

	if (typeof Image === 'function') {
		return new Promise((resolve, reject) => {
			const blobUrl = URL.createObjectURL(blob)
			const img = new Image()
			img.onload = () => {
				const { width, height } = img
				URL.revokeObjectURL(blobUrl)
				resolve({ width, height })
			}
			img.onerror = (err) => {
				URL.revokeObjectURL(blobUrl)
				reject(err)
			}
			img.src = blobUrl
		})
	}

	console.warn('[CreateImageAction] No browser APIs available to measure image dimensions; using fallback values')
	return {
		width: fallback?.width && fallback.width > 0 ? fallback.width : 512,
		height: fallback?.height && fallback.height > 0 ? fallback.height : 512,
	}
}
