import './utilities/global'

import { Environment, UserConfig } from './Contracts/Core'

import { XGenericObject } from './Contracts/Interfaces'
import { buildUrl } from './utilities/helpers'
import crypto from 'crypto'
import { getConfig } from './utilities/Manager'

/**
 * Builds request URLs.
 *
 * The static methods resolve against the process-wide config. 
 * An instance (`new Builder(() => config)`, which every `Core` exposes as
 * `core.builder`) resolves against one client's config instead, so two SDKs in
 * the same process keep their own base URL and environment.
 */
export class Builder {
    private static baseUrls = {
        live: '',
        sandbox: '',
    }

    /**
     * API Environment
     */
    static environment?: Environment

    /**
     * Environment override for this instance, set with `setEnvironment`.
     */
    environment?: Environment

    /**
     * @param resolveConfig Supplies the config this instance builds against.
     *   Omit it to build against the process-wide config.
     */
    constructor(private readonly resolveConfig?: () => UserConfig) { }

    /**
     * Sets the environment for the builder
     * 
     * @param env
     */
    static setEnvironment(env: Environment) {
        this.environment = env
    }

    /**
     * Gets the base url based on environment
     * 
     * @returns 
     */
    static baseUrl() {
        return Builder.resolveBaseUrl(getConfig(), this.environment)
    }

    /**
     * Resolve the base URL for a config, preferring an explicit environment.
     *
     * @param config
     * @param environment
     */
    static resolveBaseUrl(config: UserConfig, environment?: Environment) {
        const env = environment
            ?? config.environment
            ?? this.normalizeEnvironment(process.env.ENVIRONMENT)
            ?? 'sandbox'
        const configuredUrl = config.urls?.[env]

        if (configuredUrl) {
            return this.normalizeBaseUrl(configuredUrl)
        }

        return this.normalizeBaseUrl(this.baseUrls[env])
    }

    /**
     * The config this instance builds against.
     */
    config(): UserConfig {
        return this.resolveConfig?.() ?? getConfig()
    }

    /**
     * Sets the environment for this instance only.
     *
     * @param env
     */
    setEnvironment(env: Environment) {
        this.environment = env
    }

    /**
     * Gets this instance's base url.
     */
    baseUrl() {
        return Builder.resolveBaseUrl(
            this.config(),
            this.environment ?? (this.resolveConfig ? undefined : Builder.environment)
        )
    }

    /**
     * Builds a full url against this instance's base url.
     *
     * @param endpoint
     */
    buildUrl(...endpoint: string[]) {
        return buildUrl(this.baseUrl(), ...endpoint)
    }

    /**
     * Builds the target url against this instance's base url.
     *
     * @param path
     * @param params
     * @param queryParams
     */
    buildTargetUrl(path: string, params: XGenericObject = {}, queryParams: XGenericObject = {}) {
        const url = this.buildUrl(path)
        const withPath = Builder.assignParamsToUrl(url, params, 'path')

        return Builder.assignParamsToUrl(withPath, queryParams, 'query')
    }

    /**
     * @see Builder.buildParams
     * 
     * @param params 
     * @param type 
     * @returns 
     */
    buildParams(params: XGenericObject, type: 'query' | 'path' = 'path') {
        return Builder.buildParams(params, type)
    }

    /**
     * @see Builder.assignParamsToUrl
     * 
     * @param url 
     * @param params 
     * @param type 
     * @returns 
     */
    assignParamsToUrl(url: string, params: XGenericObject, type: 'query' | 'path' = 'path') {
        return Builder.assignParamsToUrl(url, params, type)
    }

    /**
     * Encrypts details with this instance's encryption key.
     *
     * @see Builder.encryptDetails
     * 
     * @param input 
     * @param keysToEncrypt 
     * @param outputMapping 
     * @returns 
     */
    encryptDetails<X extends XGenericObject>(
        input: Partial<X>,
        keysToEncrypt: (keyof X)[] = [],
        outputMapping: Partial<Record<keyof X, string>> = {}
    ): Promise<X> {
        return Builder.encryptDetailsWith(this.config().encryptionKey, input, keysToEncrypt, outputMapping)
    }

    /**
     * @see Builder.encryptAES
     * 
     * @param data 
     * @param token 
     * @param nonce 
     * @returns 
     */
    encryptAES(data: string, token: string, nonce: string): Promise<string> {
        return Builder.encryptAES(data, token, nonce)
    }

    /**
     * Builds a full url based on endpoint provided
     * 
     * @param endpoint 
     * @returns 
     */
    static buildUrl(...endpoint: string[]) {
        return buildUrl(this.baseUrl(), ...endpoint)
    }

    /**
     * Builds parameters for query or path
     * 
     * @param params 
     * @param type 
     * @returns 
     */
    static buildParams(params: XGenericObject, type: 'query' | 'path' = 'path') {
        if (type === 'path') {
            return Object.values(params).join('/')
        } else {
            const queryParams: string[] = []

            for (const [key, value] of Object.entries(params)) {
                queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            }

            return queryParams.join('&')
        }
    }

    /**
     * Assigns parameters to url {placeholders} based on type
     * 
     * @param url 
     * @param params 
     * @param type 
     * 
     * @returns 
     */
    static assignParamsToUrl(
        url: string,
        params: XGenericObject,
        type: 'query' | 'path' = 'path'
    ): string {
        let builtUrl = url

        if (type === 'path') {
            for (const [key, value] of Object.entries(params)) {
                builtUrl = builtUrl.replace(`{${key}}`, encodeURIComponent(String(value)))
                builtUrl = builtUrl.replace(`:${key}`, encodeURIComponent(String(value)))
            }
        } else {
            if (Object.keys(params).length === 0) {
                return builtUrl
            }

            const queryString = this.buildParams(params, 'query')
            const separator = builtUrl.includes('?') ? '&' : '?'
            builtUrl += `${separator}${queryString}`
        }

        return builtUrl
    }

    /**
     * Builds the target url by assigning both path and query parameters
     * 
     * @param path 
     * @param params 
     * @param queryParams 
     * @returns 
     */
    static buildTargetUrl(
        path: string,
        params: XGenericObject = {},
        queryParams: XGenericObject = {}
    ) {
        const url = this.buildUrl(path)

        let builtUrl = this.assignParamsToUrl(url, params, 'path')

        builtUrl = this.assignParamsToUrl(builtUrl, queryParams, 'query')

        return builtUrl
    }

    /**
     * Encrypts specified keys in the input object and returns a new object with 
     * encrypted values.
     * 
     * @param input             The input object containing the data to be encrypted.
     * @param keysToEncrypt     The keys in the input object that should be encrypted.
     * @param outputMapping     A mapping of input keys to output keys for the encrypted values.
     * @returns                 A new object with the specified keys encrypted.
     */
    static async encryptDetails<X extends XGenericObject>(
        input: Partial<X>,
        keysToEncrypt: (keyof X)[] = [],
        outputMapping: Partial<Record<keyof X, string>> = {}
    ): Promise<X> {
        return this.encryptDetailsWith(getConfig().encryptionKey, input, keysToEncrypt, outputMapping)
    }

    private static async encryptDetailsWith<X extends XGenericObject>(
        configuredKey: string | undefined,
        input: Partial<X>,
        keysToEncrypt: (keyof X)[] = [],
        outputMapping: Partial<Record<keyof X, string>> = {}
    ): Promise<X> {
        const encryptionKey = configuredKey ?? process.env.ENCRYPTION_KEY

        if (!encryptionKey) {
            throw new Error('Encryption key is required to encrypt details')
        }

        const nonce = crypto.randomBytes(12).toString('base64').slice(0, 12)
        const encryptableKeys = keysToEncrypt.length > 0
            ? keysToEncrypt
            : (Object.keys(input) as (keyof X)[])

        const encrypted = Object.fromEntries(
            Object.entries(input).map(([key, value]) => {
                if (encryptableKeys.includes(key) && typeof value === 'string') {
                    const outputKey = outputMapping?.[key] || key

                    return [outputKey, this.encryptAES(value, encryptionKey, nonce)]
                }

                return [key, value]
            })
        ) as X

        for (const key of encryptableKeys) {
            delete input[key]
        }

        return encrypted
    }

    /**
     * Encrypts data using AES-GCM encryption
     * @param data 
     * @param token 
     * @param nonce 
     * @returns 
     */
    static async encryptAES(data: string, token: string, nonce: string): Promise<string> {
        if (nonce.length !== 12) {
            throw new Error('Nonce must be exactly 12 characters long')
        }

        const cryptoSubtle = globalThis.crypto?.subtle || crypto.webcrypto?.subtle
        if (!cryptoSubtle) {
            throw new Error('Crypto API is not available in this environment.')
        }

        const decodedKeyBytes = Uint8Array.from(atob(token), c => c.charCodeAt(0))

        const key = await cryptoSubtle.importKey(
            'raw',
            decodedKeyBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        )
        const iv = new TextEncoder().encode(nonce)

        const encryptedData = await cryptoSubtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            key,
            new TextEncoder().encode(data)
        )

        return btoa(String.fromCharCode(...new Uint8Array(encryptedData)))
    }

    private static normalizeBaseUrl = (url: string): string => url.endsWith('/') ? url : `${url}/`

    private static normalizeEnvironment = (value?: string): Environment | undefined => {
        if (value === 'live' || value === 'sandbox') {
            return value
        }

        return undefined
    }
}