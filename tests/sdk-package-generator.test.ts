import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SdkPackageGenerator } from '../src/generator/SdkPackageGenerator'
import { execFileSync } from 'node:child_process'

vi.mock('node:child_process', () => ({
    execFileSync: vi.fn(),
}))


describe('SdkPackageGenerator', () => {
    const publishedSdkKitVersion = '0.1.13'

    beforeEach(() => {
        vi.mocked(execFileSync).mockReset()
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify(publishedSdkKitVersion))
    })

    const document = {
        openapi: '3.1.0',
        info: {
            title: 'Test API',
            version: '1.0.0',
        },
        paths: {
            '/app/example': {
                get: {
                    summary: 'List examples',
                    description: 'Returns the list of example resources for the provided code.',
                    operationId: 'listExamples',
                    parameters: [
                        { name: 'code', in: 'query', required: true, description: 'Country code filter.', schema: { type: 'string' } },
                        { name: 'X-Key-1', in: 'header', required: false, description: 'Optional tenant header.', schema: { type: 'string' } },
                    ],
                    responses: {
                        '200': {
                            description: 'Example collection response.',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            data: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                        code: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                post: {
                    summary: 'Create example',
                    description: 'Creates a new example resource.',
                    operationId: 'createExample',
                    parameters: [
                        { name: 'X-Key-1', in: 'header', required: false, description: 'Optional tenant header.', schema: { type: 'string' } },
                    ],
                    requestBody: {
                        description: 'Example payload used to create the resource.',
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'string' },
                                    },
                                    required: ['code'],
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Created example resource.',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            data: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'string' },
                                                    code: { type: 'string' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    } as const

    const secureDocument = {
        openapi: '3.1.0',
        info: {
            title: 'Secure API',
            version: '1.0.0',
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
                basicAuth: {
                    type: 'http',
                    scheme: 'basic',
                },
                partnerKey: {
                    type: 'apiKey',
                    name: 'X-Partner-Key',
                    in: 'header',
                },
                queryKey: {
                    type: 'apiKey',
                    name: 'api_key',
                    in: 'query',
                },
                oauth: {
                    type: 'oauth2',
                    flows: {
                        clientCredentials: {
                            tokenUrl: 'https://example.test/oauth/token',
                            scopes: {
                                charges: 'Manage charges',
                            },
                        },
                    },
                },
            },
        },
        security: [
            { bearerAuth: [] },
            { basicAuth: [] },
        ],
        paths: {
            '/charges': {
                get: {
                    security: [
                        { partnerKey: [], queryKey: [] },
                    ],
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            data: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    } as const

    it('generates runtime and class package files from the shared manifest', () => {
        const files = new SdkPackageGenerator().generate(document as never)

        expect(files['package.json']).toContain('"name": "generated-sdk"')
        expect(files['package.json']).toContain(`"@oapiex/sdk-kit": "^${publishedSdkKitVersion}"`)
        expect(files['README.md']).toContain('# generated-sdk')
        expect(files['README.md']).toContain('Generated TypeScript SDK emitted by oapiex with both class-based and runtime-first entrypoints.')
        expect(files['README.md']).toContain('pnpm add generated-sdk')
        expect(files['README.md']).toContain("import { Core, createClient, type ExampleAppQuery, type ExampleHeader } from 'generated-sdk'")
        expect(files['README.md']).toContain('await sdk.api.exampleApps.list(')
        expect(files['README.md']).toContain('await runtimeSdk.api.exampleApps.list(')
        expect(files['README.md']).toContain('`Core` for class-based usage')
        expect(files['README.md']).toContain('`createClient()` for runtime-first usage')
        expect(files['README.md']).toContain('pnpm test')
        expect(files['README.md']).toContain('pnpm build')
        expect(files['src/Schema.ts']).toContain('export const extractedApiDocumentSdk')
        expect(files['src/BaseApi.ts']).toContain('export class BaseApi extends KitBaseApi {}')
        expect(files['src/ApiBinder.ts']).toContain('exampleApps!: ExampleApp')
        expect(files['src/Apis/ExampleApp.ts']).toContain('async list (query: ExampleAppQuery, headers?: ExampleHeader): Promise<Example[]>')
        expect(files['src/Apis/ExampleApp.ts']).toContain('async create (body: ExampleInput, headers?: ExampleHeader): Promise<Example>')
        expect(files['src/Apis/ExampleApp.ts']).toContain('export class ExampleApp extends BaseApi {')
        expect(files['src/Apis/ExampleApp.ts']).not.toContain('constructor(core:')
        expect(files['src/Apis/ExampleApp.ts']).toContain('List examples')
        expect(files['src/Apis/ExampleApp.ts']).toContain('Returns the list of example resources for the provided code.')
        expect(files['src/Apis/ExampleApp.ts']).toContain('@param query code: Country code filter. Type: ExampleAppQuery')
        expect(files['src/Apis/ExampleApp.ts']).toContain('@param headers X-Key-1: Optional tenant header. Type: ExampleHeader')
        expect(files['src/Apis/ExampleApp.ts']).toContain('@returns Example collection response. Example[]')
        expect(files['src/Apis/ExampleApp.ts']).toContain('@param body Example payload used to create the resource. Type: ExampleInput')
        expect(files['src/Apis/ExampleApp.ts']).toContain('@returns Created example resource. Example')
        expect(files['src/Apis/ExampleApp.ts']).toContain('((headers ? { ...headers } : {}) as Record<string, string | undefined>)')
        expect(files['src/Core.ts']).toContain('static override apiClass = ApiBinder')
        expect(files['src/index.ts']).toContain('export * from \'./Schema\'')
        expect(files['src/index.ts']).toContain('export { ApiBinder } from \'./ApiBinder\'')
        expect(files['src/index.ts']).toContain('export { BaseApi } from \'./BaseApi\'')
        expect(files['src/index.ts']).toContain('export { ExampleApp as ExampleAppApi } from \'./Apis/ExampleApp\'')
        expect(files['src/index.ts']).not.toContain('export * from \'./Apis/ExampleApp\'')
        expect(files['src/index.ts']).toContain('): KitCore & { api: KitBaseApi & ExtractedApiDocumentApi } =>')
        expect(files['src/index.ts']).toContain('createSdk')
        expect(files['src/index.ts']).toContain('setConfigFileBasename')
        expect(files['tests/exports.test.ts']).toContain('expect(sdk.createClient).toBeTypeOf(\'function\')')
        expect(files['tests/exports.test.ts']).toContain('expect(sdk.setConfigFileBasename).toBeTypeOf(\'function\')')
        expect(files['tests/exports.test.ts']).toContain('expect(sdk.extractedApiDocumentSdk).toBeDefined()')
        expect(execFileSync).toHaveBeenCalledWith('npm', ['view', '@oapiex/sdk-kit', 'version', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
    })

    it('supports runtime-only and flat signature class generation modes', () => {
        const generator = new SdkPackageGenerator()
        const runtimeFiles = generator.generate(document as never, { outputMode: 'runtime' })
        const classFiles = generator.generate(document as never, { outputMode: 'classes', signatureStyle: 'flat' })

        expect(runtimeFiles['README.md']).toContain('Generated runtime-first TypeScript SDK emitted by oapiex.')
        expect(runtimeFiles['README.md']).toContain("import { createClient, type ExampleAppQuery, type ExampleHeader } from 'generated-sdk'")
        expect(runtimeFiles['README.md']).toContain('await runtimeSdk.api.exampleApps.list(')
        expect(runtimeFiles['README.md']).not.toContain('new Core(')
        expect(classFiles['README.md']).toContain('Generated class-based TypeScript SDK emitted by oapiex.')
        expect(classFiles['README.md']).toContain("import { Core, type ExampleAppQuery, type ExampleHeader } from 'generated-sdk'")
        expect(classFiles['README.md']).toContain('await sdk.api.exampleApps.list(')
        expect(classFiles['README.md']).toContain('{} as ExampleAppQuery["code"]')
        expect(classFiles['README.md']).not.toContain('createClient(')
        expect(runtimeFiles['src/Schema.ts']).toContain('OpenApiRuntimeBundle')
        expect(runtimeFiles['src/Core.ts']).toBeUndefined()
        expect(runtimeFiles['src/index.ts']).toContain('createBoundSdk(extractedApiDocumentSdk, options) as KitCore & { api: KitBaseApi & ExtractedApiDocumentApi }')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('@param code Country code filter. Type: ExampleAppQuery["code"]')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('@param xKey1 Optional tenant header. Type: ExampleHeader["X-Key-1"]')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('@param body Example payload used to create the resource. Type: ExampleInput')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('async list (code: ExampleAppQuery["code"], xKey1?: ExampleHeader["X-Key-1"]): Promise<Example[]>')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('async create (body: ExampleInput, xKey1?: ExampleHeader["X-Key-1"]): Promise<Example>')
        expect(classFiles['src/Apis/ExampleApp.ts']).toContain('({ "X-Key-1": xKey1 } as Record<string, string | undefined>)')
    })

    it('maps OpenAPI security schemes into generated auth helpers and metadata', () => {
        const files = new SdkPackageGenerator().generate(secureDocument as never)

        expect(files['src/Schema.ts']).toContain('export type OpenApiSecuritySchemeDefinition =')
        expect(files['src/Schema.ts']).toContain('securitySchemes: [')
        expect(files['src/Schema.ts']).toContain("helperName: 'createBearerAuth'")
        expect(files['src/Schema.ts']).toContain("helperName: 'createPartnerKeyAuth'")
        expect(files['src/Schema.ts']).toContain("parameterName: 'X-Partner-Key'")
        expect(files['src/Schema.ts']).toContain('security: [')
        expect(files['src/index.ts']).toContain('export const securitySchemes = extractedApiDocumentManifest.securitySchemes')
        expect(files['src/index.ts']).toContain('export const security = extractedApiDocumentManifest.security')
        expect(files['src/index.ts']).toContain('export const createBearerAuth = (token: string): AuthConfig => ({')
        expect(files['src/index.ts']).toContain('export const createBasicAuth = (username: string, password: string): AuthConfig => ({')
        expect(files['src/index.ts']).toContain('export const createPartnerKeyAuth = (value: string): AuthConfig => ({')
        expect(files['src/index.ts']).toContain('name: "X-Partner-Key"')
        expect(files['src/index.ts']).toContain('in: "header"')
        expect(files['src/index.ts']).toContain('export const createQueryKeyAuth = (value: string): AuthConfig => ({')
        expect(files['src/index.ts']).toContain('name: "api_key"')
        expect(files['src/index.ts']).toContain('in: "query"')
        expect(files['src/index.ts']).toContain("export const createOauthAuth = (accessToken: string, tokenType = 'Bearer'): AuthConfig => ({")
        expect(files['README.md']).toContain("import { Core, createClient, createPartnerKeyAuth, createQueryKeyAuth } from 'generated-sdk'")
        expect(files['README.md']).toContain('auth: [')
        expect(files['README.md']).toContain('createPartnerKeyAuth(process.env.PARTNER_KEY_VALUE!)')
        expect(files['README.md']).toContain('createQueryKeyAuth(process.env.QUERY_KEY_VALUE!)')
        expect(files['README.md']).toContain('generated auth helpers derived from OpenAPI security schemes')
    })

    it('uses scoped class names when nested resources would otherwise collide', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/wallets': {
                    get: {
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            id: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                '/v1/crypto/wallets/{customer_id}': {
                    get: {
                        parameters: [
                            { name: 'customer_id', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            id: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/ApiBinder.ts']).toContain('wallets!: Wallet')
        expect(files['src/ApiBinder.ts']).toContain('cryptoWallets!: CryptoWallet')
        expect(files['src/Apis/CryptoWallet.ts']).toContain('export class CryptoWallet')
    })

    it('supports configurable namespace and method naming strategies', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/crypto/wallets/{customer_id}': {
                    get: {
                        operationId: 'getCustomerCryptoWallets',
                        parameters: [
                            { name: 'customer_id', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            id: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never, {
            namespaceStrategy: 'scoped',
            methodStrategy: 'operation-id',
        })

        expect(files['src/ApiBinder.ts']).toContain('cryptoWallets!: CryptoWallet')
        expect(files['src/Apis/CryptoWallet.ts']).toContain('async getCustomerCryptoWallets (params: WalletParams): Promise<Wallet[]>')
    })

    it('treats colon-prefixed segments as path params when generating API class names', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/crypto/:id': {
                    patch: {
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            memo: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Apis/Crypto.ts']).toContain('export class Crypto')
        expect(files['src/ApiBinder.ts']).toContain('cryptos!: Crypto')
        expect(files['src/Apis/Crypto.ts']).toContain('async update (params: CryptoParams, body: CryptoInput): Promise<CryptoModel>')
        expect(files['src/Apis/Crypto.ts']).toContain("buildTargetUrl('/v1/crypto/:id', params, {})")
    })

    it('reverses singular nested SDK class names after path params and omits unused schema types', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/customers/{customer_id}/active': {
                    post: {
                        parameters: [
                            { name: 'customer_id', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            enabled: { type: 'boolean' },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Apis/ActiveCustomer.ts']).toContain("import type { Active, ActiveInput, ActiveParams } from '../Schema'")
        expect(files['src/Apis/ActiveCustomer.ts']).not.toContain('CustomerHeader')
        expect(files['src/Apis/ActiveCustomer.ts']).not.toContain('CustomerQuery')
        expect(files['src/Apis/ActiveCustomer.ts']).toContain('export class ActiveCustomer')
        expect(files['src/Apis/ActiveCustomer.ts']).toContain('async create (params: ActiveParams, body: ActiveInput): Promise<Active>')
        expect(files['src/Apis/ActiveCustomer.ts']).toContain('const { data } = await this.core.http.send<Active>(')
        expect(files['src/Apis/ActiveCustomer.ts']).not.toContain("import { Http } from '@oapiex/sdk-kit'")
        expect(files['src/index.ts']).toContain('export { ActiveCustomer as ActiveCustomerApi } from \'./Apis/ActiveCustomer\'')
    })

    it('keeps plural nested SDK class names in root-tail order after path params', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/customers/{id}/transactions': {
                    get: {
                        parameters: [
                            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            id: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Apis/CustomerTransaction.ts']).toContain('export class CustomerTransaction')
        expect(files['src/Apis/CustomerTransaction.ts']).toContain('async list (params: CustomerTransactionParams): Promise<CustomerTransactionModel[]>')
        expect(files['src/index.ts']).toContain('export { CustomerTransaction as CustomerTransactionApi } from \'./Apis/CustomerTransaction\'')
    })

    it('uses root-tail naming and list semantics for plural nested GET resources after path params', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/collections/virtual-account/{account_id}/rails': {
                    get: {
                        parameters: [
                            { name: 'account_id', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            id: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Apis/VirtualAccountRail.ts']).toContain('export class VirtualAccountRail')
        expect(files['src/Apis/VirtualAccountRail.ts']).toContain('async list (params: RailParams): Promise<Rail[]>')
        expect(files['src/index.ts']).toContain('export { VirtualAccountRail as VirtualAccountRailApi } from \'./Apis/VirtualAccountRail\'')
    })

    it('preserves singular status segments in generated schema and API names', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/collections/virtual-account/status/{reference}': {
                    get: {
                        parameters: [
                            { name: 'reference', in: 'path', required: true, schema: { type: 'string' } },
                        ],
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        reference: { type: 'string' },
                                                        status: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Schema.ts']).toContain('export interface VirtualAccountStatus')
        expect(files['src/Schema.ts']).toContain('export interface VirtualAccountStatusParams')
        expect(files['src/Schema.ts']).not.toContain('export interface Statu')
        expect(files['src/Apis/VirtualAccountStatus.ts']).toContain('import type { VirtualAccountStatus as VirtualAccountStatusModel, VirtualAccountStatusParams } from \'../Schema\'')
        expect(files['src/Apis/VirtualAccountStatus.ts']).toContain('export class VirtualAccountStatus extends BaseApi {')
        expect(files['src/Apis/VirtualAccountStatus.ts']).toContain('async get (params: VirtualAccountStatusParams): Promise<VirtualAccountStatusModel>')
        expect(files['src/ApiBinder.ts']).toContain('virtualAccountStatus!: VirtualAccountStatus')
        expect(files['src/index.ts']).toContain('export { VirtualAccountStatus as VirtualAccountStatusApi } from \'./Apis/VirtualAccountStatus\'')
    })

    it('reverses two-segment SDK class names when the path has no params', () => {
        const files = new SdkPackageGenerator().generate({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/v1/customers/enroll': {
                    post: {
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            email: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            '200': {
                                description: 'OK',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as never)

        expect(files['src/Apis/EnrollCustomer.ts']).toContain('export class EnrollCustomer')
        expect(files['src/Apis/EnrollCustomer.ts']).toContain('async create (body: EnrollInput): Promise<Enroll>')
        expect(files['src/index.ts']).toContain('export { EnrollCustomer as EnrollCustomerApi } from \'./Apis/EnrollCustomer\'')
    })
})