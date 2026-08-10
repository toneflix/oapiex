import { Musket, Application as MusketApp } from '@h3ravel/musket'
import { browser, endBrowserSession, getBrowserSession, startBrowserSession } from './Manager'
import { createDefaultConfig, mergeConfig } from './config'
import { extractReadmeOperationFromHtml, extractReadmeOperationFromHtmlAsync } from './ReadmeExtractor'

import { Logger } from '@h3ravel/shared'
import { UserConfig } from './types/app'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { resolveReadmeSidebarUrls } from './ReadmeCrawler'

export class Application extends MusketApp {
    private config: UserConfig

    constructor(config: Partial<UserConfig> = {}) {
        super()
        this.config = mergeConfig(createDefaultConfig(), config)
    }

    registerMusketListeners(musket: Musket<this>) {
        musket.afterHandle.on(() => {
            process.exit(0)
        })
    }

    getConfig(config: Partial<UserConfig> = {}): UserConfig {
        return { ...this.config, ...config }
    }

    configure(config: Partial<UserConfig>): UserConfig {
        this.config = mergeConfig(this.config, config)

        return this.config
    }

    async crawlReadmeOperations(
        source: string,
        rootOperation: ReturnType<typeof extractReadmeOperationFromHtml>,
        baseUrl: string | null
    ): Promise<{
        rootSource: string,
        discoveredUrls: string[],
        operations: Array<ReturnType<InstanceType<typeof Application>['attachSourceUrl']>>
    }> {
        const crawlBaseUrl = this.resolveCrawlBaseUrl(source, baseUrl)

        if (!crawlBaseUrl) {
            throw new Error('Crawl mode requires a remote source URL or --base-url when using a local file')
        }

        const sessionWasActive = Boolean(getBrowserSession())

        if (!sessionWasActive) {
            await startBrowserSession(this.config)
        }

        try {
            const discoveredUrls = resolveReadmeSidebarUrls(rootOperation, crawlBaseUrl)
            const rootSourceUrl = new URL(crawlBaseUrl).toString()
            const rootEntry = this.attachSourceUrl(rootSourceUrl, rootOperation)
            const urlsToFetch = discoveredUrls.filter((url) => url !== rootSourceUrl)

            const crawledOperations = await this.mapWithConcurrency(urlsToFetch, async (url) => {
                const start = Date.now()
                const html = await this.loadHtmlSource(url)
                const operation = await extractReadmeOperationFromHtmlAsync(html)
                const end = Date.now() - start

                if (!operation.method) {
                    return null
                }

                Logger.twoColumnDetail(
                    Logger.log([['Crawled', 'green'], [`${end / 1000}s`, 'gray']], ' ', false),
                    url.replace(crawlBaseUrl, '')
                )

                return this.attachSourceUrl(url, operation)
            })

            return {
                rootSource: rootSourceUrl,
                discoveredUrls,
                operations: [rootEntry, ...crawledOperations.filter((operation) => operation !== null)],
            }
        } finally {
            if (!sessionWasActive) {
                await endBrowserSession()
            }
        }
    }

    private async mapWithConcurrency<T, TResult>(
        values: T[],
        mapper: (value: T) => Promise<TResult>
    ): Promise<TResult[]> {
        const configuredConcurrency = Number.isFinite(this.config.crawlConcurrency)
            ? this.config.crawlConcurrency
            : 1
        const concurrency = Math.max(1, Math.floor(configuredConcurrency))
        const results = new Array<TResult>(values.length)
        let nextIndex = 0

        const worker = async () => {
            while (nextIndex < values.length) {
                const index = nextIndex
                nextIndex += 1
                results[index] = await mapper(values[index])
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
        )

        return results
    }

    attachSourceUrl(
        sourceUrl: string,
        operation: ReturnType<typeof extractReadmeOperationFromHtml>
    ) {
        return {
            sourceUrl,
            ...operation,
        }
    }

    resolveCrawlBaseUrl(source: string, baseUrl: string | null): string | null {
        if (baseUrl) {
            return new URL(baseUrl).toString()
        }

        if (/^https?:\/\//i.test(source)) {
            return source
        }

        return null
    }

    async loadHtmlSource(source: string, initial?: boolean): Promise<string> {
        if (!source) {
            throw new Error('A source path or URL is required')
        }

        if (/^https?:\/\//i.test(source)) {
            return browser(source, this.config, initial)
        }

        const filePath = path.resolve(process.cwd(), source)

        return readFile(filePath, 'utf8')
    }
}
