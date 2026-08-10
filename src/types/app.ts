import type { IOptionalBrowserSettings } from 'happy-dom'

export type BrowserName = 'axios' | 'happy-dom' | 'jsdom' | 'puppeteer'

export type SdkKitEnvironment = 'sandbox' | 'live'

export type SdkKitDebugLevel = 0 | 1 | 2 | 3

export type SdkKitHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface SdkKitUrls {
    live?: string
    sandbox?: string
}

export interface SdkKitBearerAuthConfig {
    type: 'bearer'
    token: string
    prefix?: string
}

export interface SdkKitOAuth2AuthConfig {
    type: 'oauth2'
    accessToken: string
    tokenType?: string
}

export interface SdkKitBasicAuthConfig {
    type: 'basic'
    username: string
    password: string
}

export interface SdkKitApiKeyAuthConfig {
    type: 'apiKey'
    name: string
    value: string
    in?: 'header' | 'query' | 'cookie'
    prefix?: string
}

export interface SdkKitAuthRequestConfig {
    url: string
    method: SdkKitHttpMethod
    headers: Record<string, string>
    params: Record<string, unknown>
    body?: unknown
}

export interface SdkKitCustomAuthConfig {
    type: 'custom'
    apply: (
        request: SdkKitAuthRequestConfig
    ) => SdkKitAuthRequestConfig | Promise<SdkKitAuthRequestConfig>
}

export type SdkKitAuthConfig =
    | SdkKitBearerAuthConfig
    | SdkKitOAuth2AuthConfig
    | SdkKitBasicAuthConfig
    | SdkKitApiKeyAuthConfig
    | SdkKitCustomAuthConfig

export interface SdkKitConfig {
    clientId?: string
    clientSecret?: string
    encryptionKey?: string
    environment?: SdkKitEnvironment
    urls?: SdkKitUrls
    headers?: Record<string, string>
    timeout?: number
    auth?: SdkKitAuthConfig | SdkKitAuthConfig[]
    debugLevel?: SdkKitDebugLevel
}

export interface UserConfig {
    outputFormat: 'pretty' | 'json' | 'js' | 'ts'
    outputShape: 'raw' | 'openapi'
    requestTimeout: number
    maxRedirects: number
    userAgent: string
    retryCount: number
    retryDelay: number
    crawlConcurrency: number
    happyDom: IOptionalBrowserSettings
    browser: BrowserName
    puppeteer?: {
        headless?: boolean
        args?: string[]
    }
    sdkKit?: SdkKitConfig
    sdk?: SdkKitConfig
}
