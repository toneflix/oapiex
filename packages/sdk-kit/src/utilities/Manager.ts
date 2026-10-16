import { InitOptions, UserConfig } from '../Contracts/Core'
import { createDefaultConfig, defaultConfig, mergeConfig } from '../config'

import { createJiti } from 'jiti'
import path from 'node:path'

const DEFAULT_CONFIG_BASENAME = 'oapiex.config'
const CONFIG_EXTENSIONS = ['ts', 'js', 'cjs'] as const

/**
 * The process-wide config. The static `Http` / `Builder` helpers read it, and
 * every client mirrors its settings into it so that path keeps working.
 */
let globalConfig: UserConfig = createDefaultConfig()
let loadedConfigRoot: string | null = null
let configBasename = DEFAULT_CONFIG_BASENAME

/**
 * Defaults set explicitly with `updateConfig()`. Unlike the mirrored writes
 * clients make into `globalConfig`, these are inherited by new clients.
 */
let explicitDefaults: Partial<UserConfig> = {}

/** Config files already read, keyed by root directory and basename. */
const fileConfigCache = new Map<string, Partial<UserConfig> | null>()

type SyncJitiLoader = (id: string) => unknown

const resolveConfigBasenames = (basename: string = configBasename): string[] => {
    return CONFIG_EXTENSIONS.map((extension) => `${basename}.${extension}`)
}

const normalizeConfigBasename = (value: string): string => {
    const normalizedValue = value.trim()

    if (!normalizedValue) {
        return DEFAULT_CONFIG_BASENAME
    }

    return normalizedValue.replace(/\.(?:ts|js|cjs)$/u, '')
}

const pickInitOptions = (value: unknown): Partial<InitOptions> | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null
    }

    const config = value as Record<string, unknown>
    const scoped = config.sdkKit ?? config.sdk

    if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) {
        return pickInitOptions(scoped)
    }

    const knownKeys = ['clientId', 'clientSecret', 'encryptionKey', 'environment', 'urls', 'headers', 'timeout', 'auth', 'debugLevel'] as const
    const nextConfig = knownKeys.reduce<Partial<InitOptions>>((result, key) => {
        if (config[key] !== undefined) {
            result[key] = config[key] as never
        }

        return result
    }, {})

    return Object.keys(nextConfig).length > 0 ? nextConfig : null
}

const loadUserConfig = (
    rootDir: string = process.cwd(),
    basename: string = configBasename
): Partial<UserConfig> | null => {
    const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        moduleCache: false,
        fsCache: false,
    })
    const syncLoad = jiti as unknown as SyncJitiLoader

    for (const filename of resolveConfigBasenames(normalizeConfigBasename(basename))) {
        const configPath = path.join(rootDir, filename)

        try {
            const loaded = syncLoad(configPath)
            const loadedModule = (typeof loaded === 'object' && loaded !== null
                ? loaded as Record<string, unknown>
                : null)
            const resolved = loadedModule?.default ?? loadedModule?.config ?? loaded
            const sdkConfig = pickInitOptions(resolved)

            if (sdkConfig) {
                return sdkConfig
            }
        } catch {
            continue
        }
    }

    return null
}

const setConfigFileBasename = (value: string): string => {
    configBasename = normalizeConfigBasename(value)
    loadedConfigRoot = null
    globalConfig = createDefaultConfig()

    return configBasename
}

/**
 * Merge two partial configs, combining `urls` and `headers` instead of
 * replacing them.
 */
const mergePartialConfig = (
    base: Partial<UserConfig>,
    config: Partial<UserConfig>
): Partial<UserConfig> => ({
    ...base,
    ...config,
    ...(base.urls || config.urls ? { urls: { ...(base.urls ?? {}), ...(config.urls ?? {}) } } : {}),
    ...(base.headers || config.headers ? { headers: { ...(base.headers ?? {}), ...(config.headers ?? {}) } } : {}),
})

const getConfigFileBasename = (): string => configBasename

const ensureConfigLoaded = (rootDir: string = process.cwd()): UserConfig => {
    if (loadedConfigRoot === rootDir) {
        return globalConfig
    }

    globalConfig = createDefaultConfig()
    loadedConfigRoot = rootDir

    const userConfig = loadUserConfig(rootDir)

    if (userConfig) {
        globalConfig = mergeConfig(globalConfig, userConfig)
    }

    return globalConfig
}

/**
 * Set process-wide defaults. They apply to the static `Http` / `Builder`
 * helpers and are inherited by clients created afterwards.
 */
const updateConfig = (config: Partial<UserConfig>): UserConfig => {
    explicitDefaults = mergePartialConfig(explicitDefaults, config)

    return mirrorConfig(config)
}

/**
 * Write into the process-wide config for the static `Http` / `Builder`
 * helpers only. Clients use this to keep that path working; new clients do
 * not inherit what it writes.
 *
 * @internal
 */
const mirrorConfig = (config: Partial<UserConfig>): UserConfig => {
    const baseConfig = ensureConfigLoaded()
    const userConfig = mergeConfig(baseConfig, config)

    globalConfig = userConfig

    return userConfig
}

const getConfig = (): UserConfig => ensureConfigLoaded()

/**
 * The config a new client starts from: the kit defaults, the config file
 * (`basename`, or the process-wide basename when omitted), and defaults set
 * explicitly with `updateConfig()`. It never includes settings other clients
 * wrote, so clients created one after another stay independent.
 *
 * @param basename A config file basename such as `maplerad.config`.
 * @param rootDir The directory the config file is looked up in.
 */
const getBaseConfig = (basename?: string, rootDir: string = process.cwd()): UserConfig => {
    const resolvedBasename = normalizeConfigBasename(basename ?? configBasename)
    const cacheKey = `${rootDir}\u0000${resolvedBasename}`

    if (!fileConfigCache.has(cacheKey)) {
        fileConfigCache.set(cacheKey, loadUserConfig(rootDir, resolvedBasename))
    }

    const fileConfig = fileConfigCache.get(cacheKey)
    const withFile = fileConfig ? mergeConfig(createDefaultConfig(), fileConfig) : createDefaultConfig()

    return mergeConfig(withFile, explicitDefaults)
}

const resetConfig = (): UserConfig => {
    loadedConfigRoot = null
    configBasename = DEFAULT_CONFIG_BASENAME
    globalConfig = createDefaultConfig()
    explicitDefaults = {}
    fileConfigCache.clear()

    return globalConfig
}

export {
    getBaseConfig,
    getConfigFileBasename,
    getConfig,
    mirrorConfig,
    setConfigFileBasename,
    updateConfig,
    globalConfig,
    defaultConfig,
    resetConfig,
    loadUserConfig,
}