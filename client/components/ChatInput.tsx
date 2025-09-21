import { ChangeEvent, FormEventHandler, useRef, useState } from 'react'
import { createShapeId, Editor, TLImageAsset, useValue } from 'tldraw'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../worker/models'
import { TldrawAgent } from '../agent/TldrawAgent'
import { ContextItemTag } from './ContextItemTag'
import { AtIcon } from './icons/AtIcon'
import { BrainIcon } from './icons/BrainIcon'
import { ChevronDownIcon } from './icons/ChevronDownIcon'
import { SelectionTag } from './SelectionTag'
import { convertTldrawShapeToSimpleShape } from '../../shared/format/convertTldrawShapeToSimpleShape'

export function ChatInput({
	agent,
	handleSubmit,
	inputRef,
}: {
	agent: TldrawAgent
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement>
}) {
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const [isUploading, setIsUploading] = useState(false)
	const isGenerating = useValue('isGenerating', () => agent.isGenerating(), [agent])
	const fileInputRef = useRef<HTMLInputElement>(null)

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'target-shape' || tool.id === 'target-area'
		},
		[editor]
	)

	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue(agent.$contextItems)
	const modelName = useValue(agent.$modelName)

	const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		event.target.value = ''
		if (!file) return
		if (!file.type.startsWith('image/')) {
			console.warn('[ChatInput] Ignoring non-image upload:', file.type)
			return
		}

		setIsUploading(true)
		try {
			await insertImageFromFile(editor, agent, file)
		} catch (error) {
			console.error('[ChatInput] Failed to insert uploaded image', error)
		} finally {
			setIsUploading(false)
		}
	}

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					setInputValue('')
					handleSubmit(e)
				}}
			>
				<div className="prompt-tags">
					<div className={'chat-context-select ' + (isContextToolActive ? 'active' : '')}>
						<div className="chat-context-select-label">
							<AtIcon /> Add Context
						</div>
						<select
							id="chat-context-select"
							value=" "
							onChange={(e) => {
								const action = ADD_CONTEXT_ACTIONS.find((action) => action.name === e.target.value)
								if (action) action.onSelect(editor)
							}}
						>
							{ADD_CONTEXT_ACTIONS.map((action) => {
								return (
									<option key={action.name} value={action.name}>
										{action.name}
									</option>
								)
							})}
						</select>
					</div>
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => (
						<ContextItemTag
							editor={editor}
							onClick={() => agent.removeFromContext(item)}
							key={'context-item-' + i}
							item={item}
						/>
					))}
				</div>

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					placeholder="Ask, learn, brainstorm, draw"
					value={inputValue}
					onInput={(e) => setInputValue(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							//idk about this but it works oops -max
							const form = e.currentTarget.closest('form')
							if (form) {
								const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
								form.dispatchEvent(submitEvent)
							}
						}
					}}
				/>
				<span className="chat-actions">
					<div className="chat-actions-left">
						<button
							type="button"
							className="chat-upload-button"
							onClick={() => fileInputRef.current?.click()}
							disabled={isUploading}
							title="Upload image"
						>
							{isUploading ? 'Uploading…' : '📎 Image'}
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							onChange={handleFileChange}
							hidden
						/>
						<div className="chat-model-select">
							<div className="chat-model-select-label">
								<BrainIcon /> {modelName}
							</div>
							<select
								value={modelName}
								onChange={(e) => agent.$modelName.set(e.target.value as AgentModelName)}
							>
								{Object.values(AGENT_MODEL_DEFINITIONS).map((model) => (
									<option key={model.name} value={model.name}>
										{model.name}
									</option>
								))}
							</select>
							<ChevronDownIcon />
						</div>
					</div>
					<button
						className="chat-input-submit"
						disabled={(inputValue === '' && !isGenerating) || isUploading}
					>
						{isGenerating && inputValue === '' ? '◼' : '⬆'}
					</button>
				</span>
			</form>
		</div>
	)
}

async function insertImageFromFile(editor: Editor, agent: TldrawAgent, file: File) {
	const asset = await editor.getAssetForExternalContent({ type: 'file', file })
	if (!asset || asset.type !== 'image') {
		throw new Error('Uploaded file could not be converted into an image asset')
	}

	let shapeId = createShapeId()
	const imageAsset = asset as TLImageAsset
	const viewport = editor.getViewportPageBounds()
	const viewportAny = viewport as { x: number; y: number; w?: number; h?: number; width?: number; height?: number } | null
	const width = imageAsset.props.w ?? 512
	const height = imageAsset.props.h ?? 512
	const viewportWidth = viewportAny ? viewportAny.w ?? viewportAny.width ?? 0 : 0
	const viewportHeight = viewportAny ? viewportAny.h ?? viewportAny.height ?? 0 : 0
	const centerX = viewportAny ? viewportAny.x + viewportWidth / 2 : 0
	const centerY = viewportAny ? viewportAny.y + viewportHeight / 2 : 0

	editor.run(() => {
		if (!editor.getAsset(imageAsset.id)) {
			editor.createAssets([imageAsset])
		}

		editor.createShape({
			id: shapeId,
			type: 'image',
			typeName: 'shape',
			opacity: 1,
			x: centerX - width / 2,
			y: centerY - height / 2,
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
				altText: file.name,
			},
		})
	})

	const createdShape = editor.getShape(shapeId)
	if (!createdShape) {
		throw new Error('Image shape was not created')
	}

	editor.selectShapes([shapeId])
	const simpleShape = convertTldrawShapeToSimpleShape(editor, createdShape)
	agent.addToContext({ type: 'shape', shape: simpleShape, source: 'user' })
}

const ADD_CONTEXT_ACTIONS = [
	{
		name: 'Pick Shapes',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-shape')
			editor.focus()
		},
	},
	{
		name: 'Pick Area',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-area')
			editor.focus()
		},
	},
	{
		name: ' ',
		onSelect: (editor: Editor) => {
			const currentTool = editor.getCurrentTool()
			if (currentTool.id === 'target-area' || currentTool.id === 'target-shape') {
				editor.setCurrentTool('select')
			}
		},
	},
]
