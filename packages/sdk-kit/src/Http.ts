import './utilities/global'

import axios, { RawAxiosRequestHeaders } from 'axios'

import { BaseApi } from './Apis/BaseApi'
import { Builder } from './Builder'
import { AuthConfig, AuthRequestConfig, HttpMethod, UnifiedResponse, UserConfig } from './Contracts/Core'
import { HttpException } from './Exceptions/HttpException'
import { XGenericObject } from './Contracts/Interfaces'
import { getConfig, mirrorConfig } from './utilities/Manager'
import { Logger } from './utilities/Log'

/**
 * Who a request belongs to: the config it is sent with, and the API that
 * records its last exception. Requests without a scope use the process-wide
 * config, exactly as before.
 */
export interface HttpScope {
    config: () => UserConfig
    api?: () => BaseApi | undefined
}

/**
 * An HTTP client bound to one `Core`'s config. Every `Core` exposes one as
 * `core.http`; it mirrors the static `Http.send` / `Http.get`.
 */
export interface ScopedHttp {
    send<R = any, M extends XGenericObject = XGenericObject> (
        url: string,
        method: HttpMethod,
        body?: any,
        headers?: RawAxiosRequestHeaders,
        params?: XGenericObject,
    ): Promise<UnifiedResponse<R, M>>
    get<R = any, M extends XGenericObject = XGenericObject> (
        url: string,
        params?: XGenericObject,
        headers?: RawAxiosRequestHeaders,
    ): Promise<UnifiedResponse<R, M>>
}

export class Http {
    /**
     * Bearer token
     */
    private static bearerToken?: string

    /**
     * Debug level
     */
    private static debugLevel: number = 0

    private static apiInstance: BaseApi

    /**
     * Creates an instance of Http.
     * 
     * @param method 
     * @param url 
     * @param headers 
     * @param body 
     */
    constructor(
        private headers: RawAxiosRequestHeaders = {},
        private body?: any,
        private scopedConfig?: UserConfig,
    ) { }

    /**
     * Create an HTTP client bound to a config, so requests carry that config's
     * auth, headers, timeout, base URL and debug level instead of the
     * process-wide ones.
     *
     * @param scope
     */
    static scoped (scope: HttpScope): ScopedHttp {
        return {
            send: (url, method, body, headers = {}, params) =>
                Http.dispatch(scope, url, method, body, headers, params),
            get: (url, params, headers = {}) =>
                Http.dispatch(scope, url, 'GET', undefined, headers, params),
        }
    }

    /**
     * Set the debug level
     * 
     * @param debug 
     */
    static setDebugLevel (level: number = 0) {
        this.debugLevel = level ?? 0
    }

    /**
     * Set the API instance
     * 
     * @param api 
     */
    static setApiInstance (api: BaseApi) {
        this.apiInstance = api
    }

    /**
     * Set the bearer token
     * 
     * @param token 
     */
    static setBearerToken (token: string) {
        this.bearerToken = token
        mirrorConfig({
            auth: {
                type: 'bearer',
                token,
            },
        })
    }

    static setAuth (auth: AuthConfig | AuthConfig[]) {
        mirrorConfig({ auth })
    }

    static setBasicAuth (username: string, password: string) {
        this.setAuth({
            type: 'basic',
            username,
            password,
        })
    }

    static setApiKey (
        name: string,
        value: string,
        location: 'header' | 'query' | 'cookie' = 'header',
        prefix?: string
    ) {
        this.setAuth({
            type: 'apiKey',
            name,
            value,
            in: location,
            prefix,
        })
    }

    static clearAuth () {
        this.bearerToken = undefined
        mirrorConfig({ auth: undefined })
    }

    private config (): UserConfig {
        return this.scopedConfig ?? getConfig()
    }

    setDefaultHeaders (defaults: Record<string, string>) {
        const config = this.config()

        this.headers = {
            ...defaults,
            ...(config.headers ?? {}),
            ...this.headers,
        }
    }

    getHeaders (): RawAxiosRequestHeaders {
        return this.headers
    }

    getBody () {
        return this.body
    }

    axiosApi () {
        const config = this.config()
        const debugLevel = this.scopedConfig ? (this.scopedConfig.debugLevel ?? 0) : Http.debugLevel

        this.setDefaultHeaders({
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        })

        const instance = axios.create({
            baseURL: this.scopedConfig ? Builder.resolveBaseUrl(this.scopedConfig) : Builder.baseUrl(),
            headers: this.getHeaders(),
            timeout: config.timeout,
        })

        if (debugLevel > 0) {
            instance.interceptors.request.use(request => {
                Logger.run('Starting Request:', {
                    url: request.url,
                    method: request.method,
                    // Remove auth token from logs for security
                    headers: debugLevel < 3 ? Object.fromEntries(
                        Object.entries(request.headers || {}).filter(([key]) => key.toLowerCase() !== 'authorization')
                    ) : request.headers,
                    params: request.params,
                    data: request.data,
                })

                return request
            }, error => {
                Logger.run('Request Error:', error)

                return Promise.reject(error)
            })

            instance.interceptors.response.use(response => {
                Logger.run('Response:', {
                    status: response.status,
                    // Remove auth token from logs for security
                    data: debugLevel < 3 ? Object.fromEntries(
                        Object.entries(response.data || {}).filter(([key]) => key.toLowerCase() !== 'access_token')
                    ) : response.data,
                })

                return response
            }, error => {
                Logger.run('Response Error:', {
                    status: error.response?.status,
                    // Remove auth token from logs for security
                    data: Object.fromEntries(
                        Object.entries(error.response?.data || {}).filter(([key]) => key.toLowerCase() !== 'access_token')
                    ),
                })

                return Promise.reject(error)
            })
        }

        return instance
    }

    /**
     * Makes a GET request
     * 
     * @param url 
     * @param headers 
     * @param params 
     * @returns 
     */
    static async get<R = any, M extends XGenericObject = XGenericObject> (
        url: string,
        params?: XGenericObject,
        headers: RawAxiosRequestHeaders = {},
    ): Promise<UnifiedResponse<R, M>> {
        return this.send<R, M>(url, 'GET', undefined, headers, params)
    }

    /**
     * 
     * 
     * @param url 
     * @param headers 
     * @param params 
     * @returns 
     */
    static async send<R = any, M extends XGenericObject = XGenericObject> (
        url: string,
        method: HttpMethod,
        body?: any,
        headers: RawAxiosRequestHeaders = {},
        params?: XGenericObject,
    ): Promise<UnifiedResponse<R, M>> {
        return this.dispatch<R, M>(undefined, url, method, body, headers, params)
    }

    private static async dispatch<R = any, M extends XGenericObject = XGenericObject> (
        scope: HttpScope | undefined,
        url: string,
        method: HttpMethod,
        body?: any,
        headers: RawAxiosRequestHeaders = {},
        params?: XGenericObject,
    ): Promise<UnifiedResponse<R, M>> {
        const config = scope?.config()

        try {
            const request = await this.prepareRequest({
                url,
                method,
                body,
                headers: this.toHeaderRecord(headers),
                params: { ...(params ?? {}) },
            }, config)
            const { data } = await new Http(request.headers, request.body, config).axiosApi()<UnifiedResponse<R & M>>({
                url: request.url,
                method: request.method,
                data: request.body,
                params: request.params,
            })

            return {
                success: true,
                message: data.message || 'Request successful',
                data: data.data ?? data as R,
                meta: data.meta as M,
            }
        } catch (e: any) {
            const error = (e.response?.data ?? {})

            throw this.exception(e.response?.status ?? 500, error || e, e, scope?.api?.())
        }
    }

    private static async prepareRequest (request: AuthRequestConfig, config?: UserConfig): Promise<AuthRequestConfig> {
        let prepared: AuthRequestConfig = {
            ...request,
            headers: { ...request.headers },
            params: { ...(request.params ?? {}) },
        }

        for (const auth of this.getConfiguredAuth(config)) {
            prepared = await this.applyAuth(prepared, auth)
        }

        return prepared
    }

    private static getConfiguredAuth (config?: UserConfig): AuthConfig[] {
        const configuredAuth = (config ?? getConfig()).auth

        if (configuredAuth) {
            return Array.isArray(configuredAuth) ? configuredAuth : [configuredAuth]
        }

        // The static bearer token belongs to the process-wide config only.
        if (!config && this.bearerToken) {
            return [{
                type: 'bearer',
                token: this.bearerToken,
            }]
        }

        return []
    }

    private static async applyAuth (
        request: AuthRequestConfig,
        auth: AuthConfig
    ): Promise<AuthRequestConfig> {
        switch (auth.type) {
            case 'bearer': {
                this.setHeaderIfMissing(
                    request.headers,
                    'Authorization',
                    `${auth.prefix ?? 'Bearer'} ${auth.token}`.trim()
                )

                return request
            }

            case 'oauth2': {
                this.setHeaderIfMissing(
                    request.headers,
                    'Authorization',
                    `${auth.tokenType ?? 'Bearer'} ${auth.accessToken}`.trim()
                )

                return request
            }

            case 'basic': {
                const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')

                this.setHeaderIfMissing(request.headers, 'Authorization', `Basic ${encoded}`)

                return request
            }

            case 'apiKey': {
                const value = auth.prefix ? `${auth.prefix} ${auth.value}`.trim() : auth.value
                const location = auth.in ?? 'header'

                if (location === 'query') {
                    if (request.params[auth.name] === undefined) {
                        request.params[auth.name] = value
                    }

                    return request
                }

                if (location === 'cookie') {
                    this.appendCookie(request.headers, auth.name, value)

                    return request
                }

                this.setHeaderIfMissing(request.headers, auth.name, value)

                return request
            }

            case 'custom': {
                return await auth.apply({
                    ...request,
                    headers: { ...request.headers },
                    params: { ...request.params },
                })
            }
        }
    }

    private static setHeaderIfMissing (
        headers: Record<string, string>,
        name: string,
        value: string
    ) {
        const existingHeaderName = Object.keys(headers).find(header => header.toLowerCase() === name.toLowerCase())

        if (!existingHeaderName) {
            headers[name] = value
        }
    }

    private static appendCookie (
        headers: Record<string, string>,
        name: string,
        value: string
    ) {
        const headerName = Object.keys(headers).find(header => header.toLowerCase() === 'cookie') ?? 'Cookie'
        const existingCookie = headers[headerName]
        const cookieEntry = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`

        if (!existingCookie) {
            headers[headerName] = cookieEntry

            return
        }

        if (!existingCookie.split(';').map(part => part.trim()).some(part => part.startsWith(`${encodeURIComponent(name)}=`))) {
            headers[headerName] = `${existingCookie}; ${cookieEntry}`
        }
    }

    /**
     * Create an HttpException from status and error
     * 
     * @param status 
     * @param error 
     * @returns 
     */
    private static exception (status: number, error: XGenericObject, originalError: Error, api?: BaseApi): Error {
        const exception = HttpException.fromCode(status, {
            success: false,
            message: `Request failed: ${error.error?.message || 'An error occurred'}`,
            status: 'failed',
            data: undefined,
            meta: {},
            error: {
                type: ((typeof error.error === 'string' ? error.error : error.error?.type) ?? 'UNKNOWN_ERROR').toUpperCase(),
                code: error.error?.code ?? '000000',
                message: error.error?.message ?? error.error_description ?? error.message,
                validation_errors: error.error?.validation_errors ?? []
            },
        }, originalError)

        const owner = api ?? this.apiInstance

        if (owner) {
            owner.setLastException(exception)
        }

        return exception
    }

    private static toHeaderRecord = (headers: RawAxiosRequestHeaders): Record<string, string> => {
        return Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [key, String(value)])
        )
    }
}