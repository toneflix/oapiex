import { endBrowserSession, isSupportedBrowser, startBrowserSession } from '../Manager'

import { Application } from 'src/Application'
import { Command } from '@h3ravel/musket'
import { Logger } from '@h3ravel/shared'
import { OutputGenerator } from '../generator/OutputGenerator'
import { UserConfig } from 'src/types/app'
import { extractReadmeOperationFromHtml, extractReadmeOperationFromHtmlAsync } from '../ReadmeExtractor'
import fs from 'node:fs/promises'
import path from 'node:path'
import { transformer } from '../OpenApiTransform'

export class ParseCommand extends Command<Application> {
    protected signature = `parse
        {source : Local HTML file path or remote URL}
        {--O|output=pretty : Output format [pretty,json,js,ts]}
        {--S|shape=raw : Result shape [raw,openapi]}
        {--B|browser? : Remote loader [axios,happy-dom,jsdom,puppeteer]}
        {--t|timeout? : Request/browser timeout in milliseconds}
        {--c|crawl : Crawl sidebar links and parse every discovered operation}
        {--b|base-url? : Base URL used to resolve sidebar links when crawling from a local file}
    `

    protected description = 'Parse a saved ReadMe page or remote documentation URL and print normalized output'

    public async handle (): Promise<void> {
        const conf = this.app.getConfig()

        const source = String(this.argument('source', '')).trim()
        const output = String(this.option('output', conf.outputFormat)).trim().toLowerCase() as UserConfig['outputFormat']
        const shape = String(this.option('shape', conf.outputShape)).trim().toLowerCase()
        const browser = String(this.option('browser', conf.browser)).trim().toLowerCase()
        const timeoutOption = String(this.option('timeout', '')).trim()
        const crawl = this.option('crawl')
        const baseUrl = String(this.option('baseUrl', '')).trim() || null
        const spinner = this.spinner(`${crawl ? 'Crawling and p' : 'P'}arsing source...`).start()
        let startedBrowserSession = false

        try {
            const start = Date.now()
            if (!isSupportedBrowser(browser)) {
                throw new Error(`Unsupported browser: ${browser}`)
            }

            const requestTimeout = this.resolveTimeoutOverride(timeoutOption, conf.requestTimeout)

            this.app.configure({ browser, requestTimeout })

            if (crawl) {
                await startBrowserSession(this.app.getConfig())
                startedBrowserSession = true
            }

            const html = await this.app.loadHtmlSource(source, true)
            const operation = await extractReadmeOperationFromHtmlAsync(html)
            const payload = crawl
                ? await this.app.crawlReadmeOperations(source, operation, baseUrl)
                : operation
            const normalizedPayload = shape === 'openapi'
                ? this.buildOpenApiPayload(payload)
                : payload
            const serialized = await OutputGenerator.serializeOutput(
                normalizedPayload,
                output,
                OutputGenerator.getRootTypeName(shape)
            )

            const filePath = await this.saveOutputToFile(
                serialized,
                source,
                shape,
                output
            )

            const duration = Date.now() - start
            Logger.twoColumnDetail(
                Logger.log([['Output', 'green'], [`${duration / 1000}s`, 'gray']], ' ', false),
                filePath.replace(process.cwd(), '.')
            )
            spinner.succeed('Parsing completed')
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'

            spinner.fail(`Failed to parse source: ${message}`)
            process.exitCode = 1
        } finally {
            if (startedBrowserSession) {
                await endBrowserSession()
            }
        }
    }

    resolveTimeoutOverride = (value: string, fallback: number): number => {
        if (!value) return fallback
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0)
            throw new Error(`Invalid timeout override: ${value}`)

        return parsed
    }

    buildOpenApiPayload = (
        payload: Awaited<ReturnType<Application['crawlReadmeOperations']>> | ReturnType<typeof extractReadmeOperationFromHtml>
    ) => {
        if ('operations' in payload) {
            return transformer.createDocument(payload.operations, 'Extracted API', '0.0.0')
        }

        return transformer.createDocument([payload], 'Extracted API', '0.0.0')
    }

    saveOutputToFile = async (
        content: string,
        source: string,
        shape: string,
        outputFormat: UserConfig['outputFormat']
    ): Promise<string> => {
        const outputDir = OutputGenerator.buildFilePath(process.cwd(), source, shape, outputFormat)
        const outputDirname = path.dirname(outputDir)
        await fs.mkdir(outputDirname, { recursive: true })
        await fs.writeFile(outputDir, content, 'utf8')

        return outputDir
    }
}
