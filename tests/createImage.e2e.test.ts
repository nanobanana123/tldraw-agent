// @ts-nocheck

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { CreateImageActionUtil } from '../shared/actions/CreateImageActionUtil'
import { SystemPromptPartUtil } from '../shared/parts/SystemPromptPartUtil'
import type { Streaming } from '../shared/types/Streaming'
import type { AgentHelpers } from '../shared/AgentHelpers'
import type { TldrawAgent } from '../client/agent/TldrawAgent'
import type { Editor } from 'tldraw'

const BASE64_PIXEL =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAucB9U6hxY0AAAAASUVORK5CYII='

describe('createImage action util', () => {
	const dataUrl = `data:image/png;base64,${BASE64_PIXEL}`

	let fetchSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchSpy = vi.fn(async () =>
			new Response(Buffer.from(BASE64_PIXEL, 'base64'), {
				headers: { 'Content-Type': 'image/png' },
			})
		)
		vi.stubGlobal('fetch', fetchSpy)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('creates an image asset and shape from a data URL', async () => {
		const createdAssets: any[] = []
		const createdShapes: any[] = []

		let latestShape: any = null
		const editor: Partial<Editor> = {
			getAssetForExternalContent: vi.fn(async () => ({
				id: 'asset:image-1',
				typeName: 'asset',
				type: 'image',
				props: { w: 64, h: 64, mimeType: 'image/png', name: 'agent-image.png', src: 'asset:image-1' },
				meta: {},
			})),
			getAsset: vi.fn((id: string) => createdAssets.find((asset) => asset.id === id)),
			createAssets: vi.fn((assets: any[]) => {
				createdAssets.push(...assets)
			}),
			createShape: vi.fn((shape: any) => {
				createdShapes.push(shape)
				latestShape = shape
			}),
			getShape: vi.fn(() => latestShape),
			updateShape: vi.fn(),
			resolveAssetUrl: vi.fn(async () => 'blob:http://example.com/image'),
			run: (fn: () => void) => fn(),
		}

		const agent = { editor } as unknown as TldrawAgent
		const util = new CreateImageActionUtil(agent)

		const helpers = {
			removeOffsetFromVec: ({ x, y }: { x: number; y: number }) => ({ x, y }),
			ensureShapeIdIsUnique: (id: string) => id,
			markImageCreated: vi.fn(),
			scheduleImageRetry: vi.fn(),
		} as unknown as AgentHelpers

		const action = {
			_type: 'createImage',
			intent: 'Insert edited photo',
			shapeId: 'image-007',
			dataUrl,
			x: 100,
			y: 200,
			w: 128,
			h: 256,
			altText: 'Edited product hero',
			complete: true,
			time: 0,
		} satisfies Streaming<any>

		await util.applyAction(action, helpers)

		expect(fetchSpy).toHaveBeenCalledWith(dataUrl)
		expect(editor.getAssetForExternalContent).toHaveBeenCalled()
		expect(editor.createAssets).toHaveBeenCalledOnce()
		expect(editor.createAssets.mock.calls[0][0][0].props.src).toBe(dataUrl)

		const createdShape = createdShapes[0]

		expect(createdShape).toMatchObject({
			id: 'shape:image-007',
			type: 'image',
			x: 100,
			y: 200,
			props: {
				assetId: 'asset:image-1',
				w: 128,
				h: 256,
				altText: 'Edited product hero',
			},
		})

		expect(editor.updateShape).not.toHaveBeenCalled()
	})

	it('uses sanitized shape ids when duplicates exist', async () => {
		let latestShape: any = null
		const editor: Partial<Editor> = {
			getAssetForExternalContent: vi.fn(async () => ({
				id: 'asset:image-2',
				typeName: 'asset',
				type: 'image',
				props: { w: 10, h: 10, mimeType: 'image/png', name: 'agent-image.png', src: 'asset:image-2' },
				meta: {},
			})),
			getAsset: () => undefined,
			createAssets: vi.fn(),
			createShape: vi.fn((shape: any) => { latestShape = shape }),
			getShape: vi.fn(() => latestShape),
			updateShape: vi.fn(),
			run: (fn: () => void) => fn(),
		}

		const agent = { editor } as unknown as TldrawAgent
		const util = new CreateImageActionUtil(agent)

		const helpers = {
			removeOffsetFromVec: ({ x, y }: { x: number; y: number }) => ({ x, y }),
			ensureShapeIdIsUnique: vi.fn(() => 'unique-id'),
			markImageCreated: vi.fn(),
			scheduleImageRetry: vi.fn(),
		} as unknown as AgentHelpers

		const action = {
			_type: 'createImage',
			intent: 'Replace screenshot',
			shapeId: 'duplicate-id',
			dataUrl,
			x: 0,
			y: 0,
			complete: true,
			time: 0,
		} satisfies Streaming<any>

		const sanitized = util.sanitizeAction(action, helpers)
		expect(helpers.ensureShapeIdIsUnique).toHaveBeenCalledWith('duplicate-id')
		expect(sanitized?.shapeId).toBe('unique-id')

		if (!sanitized) throw new Error('sanitizeAction returned null')

		await util.applyAction(sanitized, helpers)

		expect(editor.createShape).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'shape:unique-id' })
		)
		expect(editor.createAssets.mock.calls[0][0][0].props.src).toBe(dataUrl)
		expect(editor.updateShape).not.toHaveBeenCalled()
	})
})

describe('system prompt guidance', () => {
	it('encourages image edits instead of refusing', () => {
		const prompt = new SystemPromptPartUtil().buildSystemPrompt({ type: 'system' })
		expect(prompt).toContain('Never decline or defer an imaging task merely because it involves modifying an existing picture.')
		expect(prompt).toContain('generate a revised image, remove or overwrite the old image shape')
		expect(prompt).toContain('use the `createImage` event')
	})
})
