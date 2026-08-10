import './utilities/global'

import { Environment } from './Contracts/Core'
import { XGenericObject } from './Contracts/Interfaces'
import { buildUrl } from './utilities/helpers'
import crypto from 'crypto'
import { getConfig } from './utilities/Manager'

export class Builder {
    private static baseUrls = {
        live: '',
        sandbox: '',
    }

    /**
     * API Environment
     */
    static environment?: Environment

    constructor() { }

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
        const config = getConfig()
        const env = this.environment
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
        const encryptionKey = getConfig().encryptionKey ?? process.env.ENCRYPTION_KEY

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