import { describe, expect, it, vi } from 'vitest'

import { Application } from '../src/Application'
import axios from 'axios'
import { extractReadmeOperationFromHtml } from '../src/ReadmeExtractor'
import { readFile } from 'node:fs/promises'
import { transformer } from '../src/OpenApiTransform'

vi.mock('axios', () => {
    return {
        default: {
            get: vi.fn(),
        },
    }
})

const mockedRemoteHtml = new Map<string, string>()

describe('Application', () => {
    it('keeps the root operation in crawl mode and reuses it when building the OpenAPI-like document', async () => {
        const rootSource = 'https://docs.example.com/reference/get-customers'
        const siblingSource = 'https://docs.example.com/reference/jobs'
        const rootHtml = await readFile(new URL('./fixtures/readme-crawl-root.html', import.meta.url), 'utf8')
        const siblingHtml = await readFile(new URL('./fixtures/readme-text-response-example.html', import.meta.url), 'utf8')
        mockedRemoteHtml.set(rootSource, rootHtml)
        mockedRemoteHtml.set(siblingSource, siblingHtml)
        const mockedAxios = vi.mocked(axios.get)
        mockedAxios.mockImplementation(async (url: string) => {
            const html = mockedRemoteHtml.get(url)

            if (!html) {
                throw new Error(`Unexpected URL: ${url}`)
            }

            return {
                data: html,
            }
        })

        const app = new Application({ browser: 'axios' })
        const loadedRootHtml = await app.loadHtmlSource(rootSource)
        const crawlResult = await app.crawlReadmeOperations(
            rootSource,
            extractReadmeOperationFromHtml(loadedRootHtml),
            null,
        )

        expect(crawlResult.rootSource).toBe(rootSource)
        expect(crawlResult.discoveredUrls).toEqual([siblingSource])
        expect(crawlResult.operations.map((operation) => operation.sourceUrl)).toEqual([
            rootSource,
            siblingSource,
        ])
        expect(mockedAxios).toHaveBeenCalledTimes(2)
        expect(mockedAxios).toHaveBeenNthCalledWith(1, rootSource, expect.objectContaining({
            timeout: 50000,
            maxRedirects: 5,
        }))
        expect(mockedAxios).toHaveBeenNthCalledWith(2, siblingSource, expect.objectContaining({
            timeout: 50000,
            maxRedirects: 5,
        }))

        const document = transformer.createDocument(crawlResult.operations, 'Crawled API', '1.0.0')

        expect(document.paths).toEqual({
            '/customers': {
                get: {
                    summary: undefined,
                    description: 'Fetch the customer collection.',
                    operationId: 'getCustomers',
                    requestBody: undefined,
                    responses: {},
                },
            },
            '/jobs': {
                post: {
                    summary: undefined,
                    description: 'Queue a background job.',
                    operationId: 'postJobs',
                    requestBody: undefined,
                    responses: {
                        '202': {
                            description: '202 - Accepted',
                            content: {
                                'text/plain': {
                                    schema: {
                                        type: 'string',
                                        example: 'Accepted for processing',
                                    },
                                    example: 'Accepted for processing',
                                },
                            },
                        },
                    },
                },
            },
        })

        mockedRemoteHtml.clear()
        mockedAxios.mockReset()
    })

    it('accepts a loader override through application config', async () => {
        const source = 'https://docs.example.com/reference/get-customers'
        const html = await readFile(new URL('./fixtures/readme-crawl-root.html', import.meta.url), 'utf8')
        mockedRemoteHtml.set(source, html)
        const mockedAxios = vi.mocked(axios.get)
        mockedAxios.mockImplementation(async (url: string) => {
            const payload = mockedRemoteHtml.get(url)

            if (!payload) {
                throw new Error(`Unexpected URL: ${url}`)
            }

            return {
                data: payload,
            }
        })

        const app = new Application({ browser: 'axios' })
        const loadedHtml = await app.loadHtmlSource(source)

        expect(app.getConfig().browser).toBe('axios')
        expect(loadedHtml).toBe(html)

        mockedRemoteHtml.clear()
        mockedAxios.mockReset()
    })

    it('bounds concurrent page loads while preserving crawl order', async () => {
        const rootSource = 'https://docs.example.com/reference/root'
        const html = await readFile(new URL('./fixtures/readme-text-response-example.html', import.meta.url), 'utf8')
        const rootOperation = extractReadmeOperationFromHtml(html)
        const urls = Array.from({ length: 6 }, (_, index) => `${rootSource}/${index}`)
        rootOperation.sidebarLinks = urls.map((href, index) => ({
            section: null,
            href,
            label: `Operation ${index}`,
            method: null,
            active: false,
            subpage: false,
        }))

        let activeLoads = 0
        let peakLoads = 0
        const mockedAxios = vi.mocked(axios.get)
        mockedAxios.mockImplementation(async () => {
            activeLoads += 1
            peakLoads = Math.max(peakLoads, activeLoads)
            await new Promise((resolve) => setTimeout(resolve, 5))
            activeLoads -= 1

            return { data: html }
        })

        const app = new Application({ browser: 'axios', crawlConcurrency: 2 })
        const result = await app.crawlReadmeOperations(rootSource, rootOperation, null)

        expect(peakLoads).toBe(2)
        expect(result.operations.slice(1).map((operation) => operation.sourceUrl)).toEqual(urls)

        mockedAxios.mockReset()
    })
})
