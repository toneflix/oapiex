import './utilities/global'

import { AccessValidationResult, AuthConfig, DebugLevel, Environment, InitOptions, UserConfig } from './Contracts/Core'
import { InferRuntimeSdkApi, RuntimeSdkBundle } from './types'

import { BaseApi } from './Apis/BaseApi'
import { Builder } from './Builder'
import { Http, ScopedHttp } from './Http'
import { createRuntimeApi } from './RuntimeSdk'
import { getConfig, updateConfig } from './utilities/Manager'
import { mergeConfig } from './config'

export class Core {
    static apiClass: typeof BaseApi = BaseApi

    debugLevel: DebugLevel = 0

    /**
     * Client ID
     */
    private clientId?: string

    /**
     * Client Secret
     */
    private clientSecret?: string

    /**
     * API Environment
     */
    private environment: Environment = 'live'

    private accessValidator?: (core: Core) => AccessValidationResult | Promise<AccessValidationResult>

    /**
     * API Instance
     */
    api: BaseApi

    /**
     * This client's config. Every request made through `builder` and `http`
     * uses it, so several clients (several SDKs) can live in one process
     * without overwriting each other's base URL, environment or auth.
     */
    private config: UserConfig = getConfig()

    /**
     * URL builder bound to this client's config.
     */
    builder: Builder = new Builder(() => this.config)

    /**
     * HTTP client bound to this client's config. Generated SDKs send through
     * this; the static `Http.send` still uses the process-wide config.
     */
    http: ScopedHttp = Http.scoped({
        config: () => this.config,
        api: () => this.api,
    })

    /**
     * Creates an instance of Core.
     * 
     * @param clientId 
     * @param clientSecret 
     * @param encryptionKey 
     */
    constructor(clientId?: InitOptions)
    constructor(clientId?: string, clientSecret?: string, encryptionKey?: string, env?: Environment, config?: Partial<UserConfig>)
    constructor(
        clientId?: string | InitOptions,
        clientSecret?: string,
        encryptionKey?: string,
        env?: Environment,
        config?: Partial<UserConfig>
    ) {
        const currentConfig = getConfig()
        const resolvedConfig = clientId && typeof clientId === 'object'
            ? this.resolveInitOptionsFromObject(clientId, currentConfig)
            : this.resolveInitOptionsFromArgs(clientId, clientSecret, encryptionKey, env, config, currentConfig)

        this.clientId = Core.normalizeCredential(resolvedConfig.clientId)
        this.clientSecret = Core.normalizeCredential(resolvedConfig.clientSecret)
        this.environment = resolvedConfig.environment
            ?? Core.normalizeEnvironment(process.env.ENVIRONMENT)
            ?? 'live'

        this.configure({
            ...resolvedConfig,
            environment: this.environment,
        })
        this.debug(resolvedConfig.debugLevel ?? 0)

        if (!this.clientSecret && !this.hasConfiguredAuth()) {
            throw new Error('Client Secret is required to initialize API instance when auth is not provided')
        }

        this.api = this.createApi()
    }

    protected createApi (): BaseApi {
        const ApiClass = (this.constructor as typeof Core).apiClass ?? BaseApi

        return ApiClass.initialize(this)
    }

    /**
     * Initializes the Core instance
     * 
     * @param clientId 
     * @param clientSecret 
     * @param encryptionKey 
     * @param accessToken 
     * @returns 
     */
    init (clientId?: InitOptions): this
    init (clientId?: string, clientSecret?: string, encryptionKey?: string, env?: Environment, config?: Partial<UserConfig>): this
    init (clientId?: any, clientSecret?: string, encryptionKey?: string, env?: Environment, config?: Partial<UserConfig>): this {
        return new (this.constructor as any)(
            clientId,
            clientSecret,
            encryptionKey,
            env,
            config
        )
    }

    configure (config: Partial<UserConfig>): this {
        // The client keeps its own copy; the process-wide config is still updated
        // so code using the static `Http`/`Builder` behaves as it always has.
        updateConfig(config)
        const nextConfig = mergeConfig(this.config, config)

        this.config = nextConfig

        if (nextConfig.environment) {
            this.environment = nextConfig.environment
            Builder.setEnvironment(nextConfig.environment)
        }

        if ('clientId' in config) {
            this.clientId = Core.normalizeCredential(nextConfig.clientId)
        }

        if ('clientSecret' in config) {
            this.clientSecret = Core.normalizeCredential(nextConfig.clientSecret)
        }

        if (nextConfig.debugLevel !== undefined) {
            this.debug(nextConfig.debugLevel)
        }

        return this
    }

    /**
     * Set the debug level
     * 
     * @param level 
     * @returns 
     */
    debug (level: DebugLevel = 0): this {
        this.debugLevel = level
        this.config = { ...this.config, debugLevel: level }

        Http.setDebugLevel(level)

        return this
    }

    /**
     * Get the current environment
     * 
     * @returns 
     */
    getEnvironment () {
        return this.environment
    }

    /**
     * Get the configured client identifier.
     */
    getClientId () {
        return this.clientId
    }

    /**
     * Get the configured client secret.
     */
    getClientSecret () {
        return this.clientSecret
    }

    /**
     * Get this client's config.
     */
    getConfig (): UserConfig {
        return this.config
    }

    /**
     * Replace the active auth strategy.
     */
    setAuth (auth: AuthConfig | AuthConfig[]): this {
        return this.configure({ auth })
    }

    /**
     * Clear any configured auth strategy.
     */
    clearAuth (): this {
        Http.clearAuth()
        this.config = { ...this.config, auth: undefined }

        return this
    }

    /**
     * Set access validator function
     * 
     * @param validator Function to validate access
     */
    setAccessValidator (validator: (core: Core) => AccessValidationResult | Promise<AccessValidationResult>) {
        this.accessValidator = validator

        return this
    }

    /**
     * Validates access using the provided access validator function
     * 
     * @throws Error if validation fails
     */
    async validateAccess () {
        const check = this.accessValidator ? await this.accessValidator(this) : true

        if (check === true || check == null) {
            return
        }

        if (this.isAuthConfigOrArray(check)) {
            this.setAuth(check)

            return
        }

        if (this.isConfigUpdate(check)) {
            this.configure(check)

            return
        }

        throw new Error(typeof check === 'string' ? check : 'Access validation failed')
    }

    /**
     * Use a manifest bundle to create the API instance
     * 
     * @param bundle 
     * @returns 
     */
    useDocument<TBundle extends RuntimeSdkBundle> (
        bundle: TBundle
    ): this & { api: BaseApi & InferRuntimeSdkApi<TBundle> } {
        this.api = createRuntimeApi(this, bundle)

        return this as this & { api: BaseApi & InferRuntimeSdkApi<TBundle> }
    }

    /**
     * Use a manifest bundle to create the API instance (alias for useDocument).
     * 
     * @param bundle 
     * @returns 
     */
    useSdk<TBundle extends RuntimeSdkBundle> (
        bundle: TBundle
    ): this & { api: BaseApi & InferRuntimeSdkApi<TBundle> } {
        return this.useDocument(bundle)
    }

    private static normalizeEnvironment = (value?: string): Environment | undefined => {
        if (value === 'live' || value === 'sandbox') {
            return value
        }

        return undefined
    }

    private static normalizeCredential (value?: string): string | undefined {
        if (typeof value !== 'string') {
            return undefined
        }

        const normalized = value.trim()

        return normalized ? normalized : undefined
    }

    private resolveInitOptionsFromObject (
        config: InitOptions,
        currentConfig: UserConfig
    ): UserConfig {
        return {
            ...currentConfig,
            ...config,
            clientId: Core.normalizeCredential(config.clientId)
                ?? Core.normalizeCredential(currentConfig.clientId)
                ?? Core.normalizeCredential(process.env.CLIENT_ID),
            clientSecret: Core.normalizeCredential(config.clientSecret)
                ?? Core.normalizeCredential(currentConfig.clientSecret)
                ?? Core.normalizeCredential(process.env.CLIENT_SECRET),
            environment: config.environment
                ?? currentConfig.environment
                ?? Core.normalizeEnvironment(process.env.ENVIRONMENT)
                ?? 'live',
            encryptionKey: config.encryptionKey
                ?? currentConfig.encryptionKey,
            urls: config.urls
                ?? currentConfig.urls,
            headers: config.headers
                ?? currentConfig.headers,
            timeout: config.timeout
                ?? currentConfig.timeout,
            auth: config.auth
                ?? currentConfig.auth,
            debugLevel: config.debugLevel
                ?? currentConfig.debugLevel
                ?? 0,
        }
    }

    private resolveInitOptionsFromArgs (
        clientId: string | undefined,
        clientSecret: string | undefined,
        encryptionKey: string | undefined,
        env: Environment | undefined,
        config: Partial<UserConfig> | undefined,
        currentConfig: UserConfig
    ): UserConfig {
        return {
            ...currentConfig,
            ...(config ?? {}),
            clientId: Core.normalizeCredential(clientId)
                ?? Core.normalizeCredential(currentConfig.clientId)
                ?? Core.normalizeCredential(process.env.CLIENT_ID),
            clientSecret: Core.normalizeCredential(clientSecret)
                ?? Core.normalizeCredential(currentConfig.clientSecret)
                ?? Core.normalizeCredential(process.env.CLIENT_SECRET),
            environment: env
                ?? config?.environment
                ?? currentConfig.environment
                ?? Core.normalizeEnvironment(process.env.ENVIRONMENT)
                ?? 'live',
            encryptionKey: encryptionKey
                ?? config?.encryptionKey
                ?? currentConfig.encryptionKey,
            urls: config?.urls
                ?? currentConfig.urls,
            headers: config?.headers
                ?? currentConfig.headers,
            timeout: config?.timeout
                ?? currentConfig.timeout,
            auth: config?.auth
                ?? currentConfig.auth,
            debugLevel: config?.debugLevel
                ?? currentConfig.debugLevel
                ?? 0,
        }
    }

    private hasConfiguredAuth (): boolean {
        const auth = this.config.auth

        if (Array.isArray(auth)) {
            return auth.length > 0
        }

        return auth != null
    }

    private isAuthConfigOrArray (value: unknown): value is AuthConfig | AuthConfig[] {
        if (Array.isArray(value)) {
            return value.every((entry) => this.isAuthConfig(entry))
        }

        return this.isAuthConfig(value)
    }

    private isAuthConfig (value: unknown): value is AuthConfig {
        return typeof value === 'object'
            && value !== null
            && 'type' in value
            && typeof (value as { type?: unknown }).type === 'string'
    }

    private isConfigUpdate (value: unknown): value is Partial<UserConfig> {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false
        }

        return ['auth', 'clientId', 'clientSecret', 'debugLevel', 'environment', 'headers', 'timeout', 'urls', 'encryptionKey'].some((key) => key in value)
    }
}