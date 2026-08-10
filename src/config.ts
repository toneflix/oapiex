import type { UserConfig } from './types/app'

export const defaultConfig: UserConfig = {
    outputFormat: 'pretty',
    outputShape: 'raw',
    requestTimeout: 50000,
    maxRedirects: 5,
    userAgent: 'Mozilla/5.0 (X11; Linux x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenApiExtractor/1.0.0',
    retryCount: 3,
    retryDelay: 1000,
    crawlConcurrency: 4,
    browser: 'puppeteer',
    happyDom: {
        enableJavaScriptEvaluation: true,
        suppressInsecureJavaScriptEnvironmentWarning: true,
    },
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
}

export const createDefaultConfig = (): UserConfig => ({
    ...defaultConfig,
    happyDom: {
        ...defaultConfig.happyDom,
    },
    puppeteer: defaultConfig.puppeteer
        ? {
            ...defaultConfig.puppeteer,
            args: defaultConfig.puppeteer.args
                ? [...defaultConfig.puppeteer.args]
                : undefined,
        }
        : undefined,
    sdkKit: defaultConfig.sdkKit
        ? {
            ...defaultConfig.sdkKit,
            urls: defaultConfig.sdkKit.urls
                ? { ...defaultConfig.sdkKit.urls }
                : undefined,
        }
        : undefined,
    sdk: defaultConfig.sdk
        ? {
            ...defaultConfig.sdk,
            urls: defaultConfig.sdk.urls
                ? { ...defaultConfig.sdk.urls }
                : undefined,
        }
        : undefined,
})

export const mergeConfig = (
    baseConfig: UserConfig,
    config: Partial<UserConfig>
): UserConfig => ({
    ...baseConfig,
    ...config,
    happyDom: {
        ...baseConfig.happyDom,
        ...config.happyDom,
    },
    puppeteer: config.puppeteer
        ? {
            ...(baseConfig.puppeteer ?? {}),
            ...config.puppeteer,
            args: config.puppeteer.args
                ? [...config.puppeteer.args]
                : baseConfig.puppeteer?.args,
        }
        : baseConfig.puppeteer,
    sdkKit: config.sdkKit
        ? {
            ...(baseConfig.sdkKit ?? {}),
            ...config.sdkKit,
            urls: config.sdkKit.urls
                ? {
                    ...(baseConfig.sdkKit?.urls ?? {}),
                    ...config.sdkKit.urls,
                }
                : baseConfig.sdkKit?.urls,
        }
        : baseConfig.sdkKit,
    sdk: config.sdk
        ? {
            ...(baseConfig.sdk ?? {}),
            ...config.sdk,
            urls: config.sdk.urls
                ? {
                    ...(baseConfig.sdk?.urls ?? {}),
                    ...config.sdk.urls,
                }
                : baseConfig.sdk?.urls,
        }
        : baseConfig.sdk,
})

export const defineConfig = <TConfig extends Partial<UserConfig>> (
    config: TConfig
): TConfig => config
