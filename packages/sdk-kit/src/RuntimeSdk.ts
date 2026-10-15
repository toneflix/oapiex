import { InferRuntimeSdkApi, RuntimeSdkBundle, RuntimeSdkManifest, RuntimeSdkOperationManifest, RuntimeSdkParameterManifest } from './types'

import { BaseApi } from './Apis/BaseApi'
import { Core } from './Core'
import type { InitOptions } from './Contracts/Core'

export const createRuntimeApi = <TBundle extends { manifest: RuntimeSdkManifest }> (
    core: Core,
    bundle: TBundle
): BaseApi & InferRuntimeSdkApi<TBundle> => {
    const api = BaseApi.initialize(core) as BaseApi & Record<string, unknown>

    for (const group of bundle.manifest.groups) {
        const namespace: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const operation of group.operations) {
            namespace[operation.methodName] = async (...args: unknown[]) => {
                await core.validateAccess()

                const [pathParams, queryParams, body, headers] = normalizeRuntimeArguments(operation, args)

                validateRequiredArguments(operation.pathParams, pathParams, 'path')
                validateRequiredArguments(operation.queryParams, queryParams, 'query')
                validateRequiredArguments(operation.headerParams, headers, 'header')

                if (operation.hasBody && operation.bodyRequired && body == null) {
                    throw new Error(`Missing required request body for ${operation.method} ${operation.path}`)
                }

                const { data } = await core.http.send(
                    core.builder.buildTargetUrl(operation.path, pathParams, queryParams),
                    operation.method,
                    body ?? {},
                    headers as Record<string, any>
                )

                return data
            }
        }

        api[group.propertyName] = namespace
    }

    return api as BaseApi & InferRuntimeSdkApi<TBundle>
}

export const createSdk = <TBundle extends RuntimeSdkBundle> (
    bundle: TBundle,
    options: InitOptions
): Core & { api: BaseApi & InferRuntimeSdkApi<TBundle> } => {
    const core = new Core(options)

    return core.useDocument(bundle)
}

const normalizeRuntimeArguments = (
    operation: RuntimeSdkOperationManifest,
    args: unknown[]
): [Record<string, unknown>, Record<string, unknown>, unknown, Record<string, unknown>] => {
    let cursor = 0

    const pathParams = operation.pathParams.length > 0 ? toRecord(args[cursor++]) : {}
    const queryParams = operation.queryParams.length > 0 ? toRecord(args[cursor++]) : {}
    const body = operation.hasBody ? args[cursor++] : undefined
    const headers = operation.headerParams.length > 0 ? toRecord(args[cursor]) : {}

    return [pathParams, queryParams, body, headers]
}

const validateRequiredArguments = (
    parameters: RuntimeSdkParameterManifest[],
    values: Record<string, unknown>,
    location: string
) => {
    for (const parameter of parameters) {
        if (!parameter.required) {
            continue
        }

        if (values[parameter.name] === undefined && values[parameter.accessor] === undefined) {
            throw new Error(`Missing required ${location} parameter: ${parameter.name}`)
        }
    }
}

const toRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }

    return {}
}
