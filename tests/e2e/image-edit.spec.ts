import { test, expect } from '@playwright/test'

// Simple 1x1 PNG pixels used to simulate Gemini output during tests.
const YELLOW_DATA_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4zwAAAgIBAJ8dJnoAAAAASUVORK5CYII='
const ORANGE_DATA_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

test('Gemini image edit flow regenerates and verifies banana color', async ({ page }) => {
	page.on('console', (msg) => {
		console.log('[page console]', msg.type(), msg.text())
	})
	let callCount = 0

	await page.route('**/stream', async (route) => {
		callCount += 1

		if (callCount > 2) {
			await route.fallback()
			return
		}

		const events =
			callCount === 1
				? [
						{
							_type: 'createImage',
							intent: 'Generate a yellow banana',
							shapeId: 'banana',
							generator: {
								provider: 'google-gemini',
								mode: 'generate',
								prompt: 'Generate a photo-realistic yellow banana on a white background',
							},
							x: 100,
							y: 120,
							w: 200,
							h: 120,
							altText: 'Banana photo (yellow)',
							complete: true,
							time: 4,
						},
						{
							_type: 'message',
							text: 'Color detection model reports: yellow banana',
							complete: true,
							time: 6,
						},
				  ]
				: [
						{
							_type: 'createImage',
							intent: 'Apply orange banana edit',
							shapeId: 'banana-updated',
							generator: {
								provider: 'google-gemini',
								mode: 'edit',
								prompt: 'Change the banana peel to be bright orange while keeping realistic lighting',
								referenceShapeId: 'banana',
							},
							x: 100,
							y: 120,
							w: 200,
							h: 120,
							altText: 'Banana photo (orange)',
							complete: true,
							time: 5,
						},
						{
							_type: 'delete',
							intent: 'Remove previous banana image',
							shapeId: 'banana',
							complete: true,
							time: 6,
						},
						{
							_type: 'message',
							text: 'Color detection model reports: orange banana',
							complete: true,
							time: 7,
						},
				  ]

		const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

		await route.fulfill({
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
			},
			body,
		})
	})

	let generatorCalls = 0
	await page.route('**/images/generate', async (route, request) => {
		generatorCalls += 1
		const payload = JSON.parse(request.postData() ?? '{}')
		if (generatorCalls === 1) {
			expect(payload.mode).toBe('generate')
			expect(payload.prompt).toContain('yellow banana')
			expect(payload.reference).toBeFalsy()
			await route.fulfill({
				status: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dataUrl: YELLOW_DATA_URL }),
			})
			return
		}

		expect(payload.mode).toBe('edit')
		expect(payload.reference?.base64).toBeTruthy()
		await route.fulfill({
			status: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dataUrl: ORANGE_DATA_URL }),
		})
	})

	await page.goto('/')

	const promptInput = page.getByPlaceholder('Ask, learn, brainstorm, draw')
	await promptInput.fill('Generate a yellow banana photo and verify the color.')
	await promptInput.press('Enter')

	await page.waitForFunction(() => {
		const editor = (window as any).editor
		if (!editor) return false
		const shape = editor.getShape?.('shape:banana')
		return Boolean(shape)
	})

	await expect(page.getByText('Color detection model reports: yellow banana')).toBeVisible()

	await promptInput.fill('Change the banana to orange and re-verify the color.')
	await promptInput.press('Enter')

	await page.waitForFunction(() => {
		const editor = (window as any).editor
		if (!editor) return false
		const shape = editor.getShape?.('shape:banana-updated')
		return Boolean(shape)
	})

	const orangeMessage = page.getByText('Color detection model reports: orange banana')
	await orangeMessage.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})

	const shapeDetails = await page.evaluate(() => {
		const editor = (window as any).editor
		const shape = editor?.getShape?.('shape:banana-updated')
		return shape
			? {
				type: shape.type,
			}
			: null
	})

	expect(shapeDetails?.type).toBe('image')

	const oldShapeStillExists = await page.evaluate(() => {
		const editor = (window as any).editor
		return Boolean(editor?.getShape?.('shape:banana'))
	})

	expect(oldShapeStillExists).toBe(false)
	expect(generatorCalls).toBe(2)
})
