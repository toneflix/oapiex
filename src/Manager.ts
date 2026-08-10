import type { BrowserName, UserConfig } from './types/app'
import { createDefaultConfig, defaultConfig, mergeConfig } from './config'
import { DOMWindow, JSDOM } from 'jsdom'
import type { Page, Browser as PuppeteerBrowser } from 'puppeteer'

import { Window } from 'happy-dom'
import axios from 'axios'

interface BrowserSession {
    browser: BrowserName
    closers: Array<() => Promise<void> | void>
    puppeteerBrowser?: PuppeteerBrowser
}

type CleanupCloser = () => Promise<void> | void

const terminationSignals = ['SIGINT', 'SIGTERM', 'SIGTSTP'] as const

declare global {
    var __oapieBrowserSession: BrowserSession | undefined
}

const supportedBrowsers: BrowserName[] = ['axios', 'happy-dom', 'jsdom', 'puppeteer']

let globalConfig: UserConfig = createDefaultConfig()
let cleanupInProgress = false
let terminationHandlersInstalled = false
const activeClosers = new Set<CleanupCloser>()

const getBrowserSession = (): BrowserSession | undefined => globalThis.__oapieBrowserSession

const removeTerminationHandlersWhenIdle = () => {
    if (!getBrowserSession() && activeClosers.size === 0) {
        removeTerminationHandlers()
    }
}

const ensureTerminationHandlers = () => {
    if (terminationHandlersInstalled) {
        return
    }

    for (const signal of terminationSignals) {
        process.on(signal, handleTerminationSignal)
    }

    terminationHandlersInstalled = true
}

const removeTerminationHandlers = () => {
    if (!terminationHandlersInstalled) {
        return
    }

    for (const signal of terminationSignals) {
        process.off(signal, handleTerminationSignal)
    }

    terminationHandlersInstalled = false
}

const registerActiveBrowserCloser = (closer: CleanupCloser): (() => void) => {
    ensureTerminationHandlers()
    activeClosers.add(closer)

    return () => {
        activeClosers.delete(closer)
        removeTerminationHandlersWhenIdle()
    }
}

const closeActiveBrowserResources = async (): Promise<void> => {
    const closers = Array.from(activeClosers).reverse()

    activeClosers.clear()

    for (const closer of closers) {
        await closer()
    }

    await endBrowserSession()
}

const handleTerminationSignal = async (signal: NodeJS.Signals) => {
    if (cleanupInProgress) {
        return
    }

    cleanupInProgress = true
    removeTerminationHandlers()

    try {
        await closeActiveBrowserResources()
    } catch (error) {
        console.error('Failed to close active browser resources:', error)
    } finally {
        cleanupInProgress = false
    }

    if (signal === 'SIGTSTP') {
        process.kill(process.pid, signal)

        return
    }

    process.exit(signal === 'SIGINT' ? 130 : 143)
}

const startBrowserSession = async (
    config: UserConfig = globalConfig
): Promise<BrowserSession> => {
    const activeSession = getBrowserSession()

    if (activeSession?.browser === config.browser) {
        return activeSession
    }

    if (activeSession) {
        await endBrowserSession()
    }

    const nextSession: BrowserSession = {
        browser: config.browser,
        closers: [],
    }

    if (config.browser === 'puppeteer') {
        const puppeteer = await import('puppeteer')

        nextSession.puppeteerBrowser = await puppeteer.launch({
            headless: config.puppeteer?.headless ?? true,
            args: config.puppeteer?.args ?? ['--no-sandbox', '--disable-setuid-sandbox']
        })
    }

    ensureTerminationHandlers()
    globalThis.__oapieBrowserSession = nextSession

    return nextSession
}

const endBrowserSession = async (): Promise<void> => {
    const activeSession = getBrowserSession()

    if (!activeSession) {
        return
    }

    globalThis.__oapieBrowserSession = undefined

    for (const closer of activeSession.closers.reverse()) {
        await closer()
    }

    if (activeSession.puppeteerBrowser) {
        await activeSession.puppeteerBrowser.close()
    }

    removeTerminationHandlersWhenIdle()
}

const updateConfig = (config: Partial<UserConfig>): UserConfig => {
    const userConfig = mergeConfig(globalConfig, config)

    globalConfig = userConfig

    return userConfig
}

const isSupportedBrowser = (value: string): value is BrowserName => {
    return supportedBrowsers.includes(value as BrowserName)
}

/**
 * Loads HTML content from a given source URL using the configured browser.
 * 
 * @param source    The URL of the source to load HTML from.
 * @param config    Optional user configuration to override global settings for this load operation.
 * @returns         A promise that resolves to the HTML content as a string.
 */
const browser = async (
    source: string,
    config: UserConfig = globalConfig,
    initial = false
): Promise<string> => {
    const { data } = config.browser !== 'puppeteer' ? await axios.get(source, {
        timeout: config.requestTimeout,
        maxRedirects: config.maxRedirects,
        headers: {
            'User-Agent': config.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
    }) : { data: '' }

    if (config.browser === 'axios') {
        return data
    } else if (config.browser === 'happy-dom') {
        const window = new Window({
            url: source,
            innerWidth: 1024,
            innerHeight: 768,
            settings: config.happyDom
        })
        const unregisterWindowCloser = registerActiveBrowserCloser(() => window.happyDOM.close())

        try {
            window.document.write(data)

            await window.happyDOM.waitUntilComplete()

            const html = window.document.documentElement.outerHTML

            if (!html) {
                await window.happyDOM.close()

                throw new Error(`Unable to extract HTML from remote source: ${source}`)
            }

            await window.happyDOM.close()

            return html
        } finally {
            unregisterWindowCloser()
        }

    } else if (config.browser === 'jsdom') {
        let window: DOMWindow | undefined
        let unregisterWindowCloser: (() => void) | undefined

        try {
            ({ window } = new JSDOM(data, {
                url: source,
                contentType: 'text/html',
                runScripts: 'dangerously',
                includeNodeLocations: true,
            }))
            unregisterWindowCloser = registerActiveBrowserCloser(() => window?.close())

            const html = window.document.documentElement.outerHTML
            if (!html) {
                throw new Error(`Unable to extract HTML from remote source: ${source}`)
            }

            window.close()
            window = undefined

            return html
        } finally {
            unregisterWindowCloser?.()
            if (window) window.close()
        }
    } else if (config.browser === 'puppeteer') {
        const activeSession = getBrowserSession()
        const browserTimeout = Math.max(config.requestTimeout, 30000)
        let browserInstance = activeSession?.browser === 'puppeteer'
            ? activeSession.puppeteerBrowser
            : undefined
        let shouldClose = false
        let page: Awaited<ReturnType<NonNullable<typeof browserInstance>['newPage']>> | undefined
        let unregisterBrowserCloser: (() => void) | undefined
        let unregisterPageCloser: (() => void) | undefined

        try {
            if (!browserInstance) {
                const puppeteer = await import('puppeteer')

                browserInstance = await puppeteer.launch({
                    headless: config.puppeteer?.headless ?? true,
                    args: config.puppeteer?.args ?? ['--no-sandbox', '--disable-setuid-sandbox']
                })
                shouldClose = true
                unregisterBrowserCloser = registerActiveBrowserCloser(async () => {
                    if (browserInstance?.connected) {
                        await browserInstance.close()
                    }
                })
            }

            page = await browserInstance.newPage()
            unregisterPageCloser = registerActiveBrowserCloser(async () => {
                if (page && !page.isClosed()) {
                    await page.close()
                }
            })
            await page.setUserAgent({ userAgent: config.userAgent })
            await page.setRequestInterception(true)

            page.on('request', (e) => {
                const type = e.resourceType()
                if (['image', 'font', 'media', 'stylesheet'].includes(type))
                    return void e.abort()
                e.continue()
            })

            try {
                await page.goto(source, {
                    waitUntil: 'domcontentloaded',
                    timeout: browserTimeout
                })
            } catch (error) {
                if (!page || !(await hasExtractableReadmeContent(page))) {
                    throw error
                }
            }
            let html = await extractStablePageHtml(page, browserTimeout, initial)
            if (!html) {
                throw new Error(`Unable to extract HTML from remote source: ${source}`)
            }

            if (!html.includes('id="ssr-props"')) {
                const { data: rawHtml } = await axios.get<string>(source, {
                    timeout: config.requestTimeout,
                    maxRedirects: config.maxRedirects,
                    headers: {
                        'User-Agent': config.userAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    },
                })

                html = mergeSsrPropsIntoRenderedHtml(html, rawHtml)
            }

            return html
        } finally {
            unregisterPageCloser?.()
            if (page && !page.isClosed()) {
                await page.close()
            }

            unregisterBrowserCloser?.()
            if (shouldClose && browserInstance) {
                await browserInstance.close()
            }
        }
    } else {
        throw new Error(`Unsupported browser specified in configuration: ${globalConfig.browser}`)
    }
}

const waitForExtractableReadmeContent = async (
    page: Page,
    timeout: number,
    initial = false
): Promise<void> => {
    try {
        if (initial) await page.waitForSelector('.hub-sidebar-content .rm-Sidebar-link')
        await page.waitForSelector(
            '[data-testid="http-method"], article#content, script#ssr-props',
            { timeout }
        )
    } catch {
        // Continue and let downstream extraction decide whether the page is usable.
    }
}

const waitForOperationHydration = async (page: Page, timeout: number): Promise<void> => {
    try {
        await page.waitForFunction(() => {
            const hasMethod = !!document.querySelector('[data-testid="http-method"]')
            const hasRequestForm = !!document.querySelector('form[name="Parameters"]')
            const hasReqPlayground = !!document.querySelector('.rm-PlaygroundRequest')
            const hasResPlayground = !!document.querySelector('.rm-PlaygroundResponse')
            const hasSsrProps = !!document.querySelector('script#ssr-props')

            if (!hasMethod) {
                return false
            }

            return hasRequestForm || hasReqPlayground || hasResPlayground || hasSsrProps
        }, { timeout })
    } catch {/** */ }

    try {
        await page.waitForSelector('.rm-PlaygroundRequest, .rm-PlaygroundResponse, form[name="Parameters"], script#ssr-props', {
            timeout: Math.min(timeout, 5000)
        })
    } catch {/** */ }

    try {
        await page.waitForNetworkIdle?.({ idleTime: 500, timeout: Math.min(timeout, 5000) })
    } catch {/** */ }

    try {
        // await (page as any).waitForTimeout?.(750)
    } catch {/** */ }
}

const extractStablePageHtml = async (
    page: Page,
    timeout: number,
    initial = false,
    maxAttempts = 3
): Promise<string> => {
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await waitForExtractableReadmeContent(page, timeout, initial)
            await waitForOperationHydration(page, timeout)

            return await page.content()
        } catch (error) {
            lastError = error

            if (!isExecutionContextNavigationError(error) || attempt === maxAttempts) {
                throw error
            }

            await waitForNavigationSettle(page, timeout)
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('Unable to extract stable HTML from remote source')
}

const waitForNavigationSettle = async (page: Page, timeout: number): Promise<void> => {
    try {
        await page.waitForFunction(() => {
            return document.readyState === 'interactive' || document.readyState === 'complete'
        }, { timeout: Math.min(timeout, 5000) })
    } catch {/** */ }

    try {
        await page.waitForNetworkIdle?.({ idleTime: 500, timeout: Math.min(timeout, 5000) })
    } catch {/** */ }
}

const isExecutionContextNavigationError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
        return false
    }

    const message = error.message.toLowerCase()

    return message.includes('execution context was destroyed')
        || message.includes('cannot find context with specified id')
        || message.includes('most likely because of a navigation')
}

const hasExtractableReadmeContent = async (
    page: {
        $: (selector: string) => Promise<unknown>
    }
): Promise<boolean> => {
    return Boolean(
        await page.$('[data-testid="http-method"], article#content, script#ssr-props')
    )
}

const mergeSsrPropsIntoRenderedHtml = (renderedHtml: string, rawHtml: string): string => {
    if (renderedHtml.includes('id="ssr-props"')) {
        return renderedHtml
    }

    const ssrPropsScript = extractSsrPropsScript(rawHtml)

    if (!ssrPropsScript) {
        return renderedHtml
    }

    if (renderedHtml.includes('</body>')) {
        return renderedHtml.replace('</body>', `${ssrPropsScript}</body>`)
    }

    if (renderedHtml.includes('</html>')) {
        return renderedHtml.replace('</html>', `${ssrPropsScript}</html>`)
    }

    return `${renderedHtml}${ssrPropsScript}`
}

const extractSsrPropsScript = (html: string): string | null => {
    const match = html.match(/<script id="ssr-props"[^>]*>[\s\S]*?<\/script>/i)

    return match?.[0] ?? null
}

export {
    updateConfig,
    browser,
    closeActiveBrowserResources,
    registerActiveBrowserCloser,
    globalConfig,
    defaultConfig,
    supportedBrowsers,
    startBrowserSession,
    endBrowserSession,
    getBrowserSession,
    isSupportedBrowser,
    extractStablePageHtml,
    mergeSsrPropsIntoRenderedHtml,
}
