import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

import { TypeScriptGenerator } from '../src/generator/TypeScriptGenerator'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

describe('generate command', () => {
    afterAll(async () => {
        const workspaceRoot = path.resolve(import.meta.dirname, '..')

        await rm(path.join(workspaceRoot, 'output', 'generated-sdk-artifact'), { recursive: true, force: true })
        await rm(path.join(workspaceRoot, 'output', 'generated-sdk-url'), { recursive: true, force: true })
        await rm(path.join(workspaceRoot, 'output', 'fixture-sdk-source.openapi.ts'), { force: true })
    })

    it('generates an SDK package from a parsed TypeScript source artifact', async () => {
        const workspaceRoot = path.resolve(import.meta.dirname, '..')
        const sourceFile = path.join(workspaceRoot, 'output', 'fixture-sdk-source.openapi.ts')
        const outDir = path.join(workspaceRoot, 'output', 'generated-sdk-artifact')
        const schemaModule = TypeScriptGenerator.generateModule({
            openapi: '3.1.0',
            info: {
                title: 'Test API',
                version: '1.0.0',
            },
            paths: {
                '/app/example': {
                    get: {
                        operationId: 'listExamples',
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
        } as never, 'ExtractedApiDocument')

        await mkdir(path.dirname(sourceFile), { recursive: true })
        await writeFile(sourceFile, schemaModule, 'utf8')
        await rm(outDir, { recursive: true, force: true })

        await execFileAsync(process.execPath, [
            '--import',
            'tsx',
            'src/cli.ts',
            'generate',
            'sdk',
            sourceFile,
            `--dir=${outDir}`,
            '--name=generated-sdk-artifact',
        ], {
            cwd: workspaceRoot,
        })

        expect(await readFile(path.join(outDir, 'src', 'Schema.ts'), 'utf8')).toBe(schemaModule)
        expect(await readFile(path.join(outDir, 'package.json'), 'utf8')).toContain('"name": "generated-sdk-artifact"')
        expect(await readFile(path.join(outDir, 'src', 'Apis', 'ExampleApp.ts'), 'utf8')).toContain('export class ExampleApp')
    }, 15000)

    it('generates an SDK package directly from a documentation URL', async () => {
        const workspaceRoot = path.resolve(import.meta.dirname, '..')
        const outDir = path.join(workspaceRoot, 'output', 'generated-sdk-url')
        const fixtureHtml = await readFile(new URL('./fixtures/fw-example.html', import.meta.url), 'utf8')
        const server = createServer((request, response) => {
            if (request.url !== '/reference/customers') {
                response.writeHead(404)
                response.end('Not found')

                return
            }

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(fixtureHtml)
        })

        await rm(outDir, { recursive: true, force: true })
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve())
        })

        const address = server.address()

        if (!address || typeof address === 'string') {
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
            throw new Error('Failed to determine generate command test server address')
        }

        try {
            const url = `http://127.0.0.1:${address.port}/reference/customers`

            await execFileAsync(process.execPath, [
                '--import',
                'tsx',
                'src/cli.ts',
                'generate',
                'sdk',
                url,
                `--dir=${outDir}`,
                '--name=generated-sdk-url',
                '--browser=axios',
                '--method-strategy=operation-id',
            ], {
                cwd: workspaceRoot,
            })

            expect(await readFile(path.join(outDir, 'src', 'Schema.ts'), 'utf8')).toContain('export const extractedApiDocumentManifest = {')
            expect(await readFile(path.join(outDir, 'src', 'index.ts'), 'utf8')).toContain("export * from './Schema'")
            expect(await readFile(path.join(outDir, 'src', 'index.ts'), 'utf8')).toContain('): KitCore & { api: KitBaseApi & ExtractedApiDocumentApi } =>')
            expect(await readFile(path.join(outDir, 'src', 'index.ts'), 'utf8')).not.toContain("export * from './Apis/")
            expect(await readFile(path.join(outDir, 'tsdown.config.ts'), 'utf8')).toContain('entry: {')
            expect(await readFile(path.join(outDir, 'tests', 'exports.test.ts'), 'utf8')).toContain('expect(sdk.createClient).toBeTypeOf(\'function\')')
            expect(await readFile(path.join(outDir, 'tests', 'exports.test.ts'), 'utf8')).toContain('expect(sdk.extractedApiDocumentSdk).toBeDefined()')
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        }
    }, 30000)

    it('emits SDK classes without colon-param naming bugs or conflicting schema imports', async () => {
        const workspaceRoot = path.resolve(import.meta.dirname, '..')
        const sourceFile = path.join(workspaceRoot, 'output', 'fixture-sdk-conflict.openapi.ts')
        const outDir = path.join(workspaceRoot, 'output', 'generated-sdk-conflict')
        const schemaModule = TypeScriptGenerator.generateModule({
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
        } as never, 'ExtractedApiDocument')

        await mkdir(path.dirname(sourceFile), { recursive: true })
        await writeFile(sourceFile, schemaModule, 'utf8')
        await rm(outDir, { recursive: true, force: true })

        await execFileAsync(process.execPath, [
            '--import',
            'tsx',
            'src/cli.ts',
            'generate',
            'sdk',
            sourceFile,
            `--dir=${outDir}`,
            '--name=generated-sdk-conflict',
        ], {
            cwd: workspaceRoot,
        })

        expect(await readFile(path.join(outDir, 'src', 'Apis', 'Crypto.ts'), 'utf8')).toContain('export class Crypto')
        expect(await readFile(path.join(outDir, 'src', 'Apis', 'ActiveCustomer.ts'), 'utf8')).toContain("import type { ActiveInput, ActiveParams, Crypto } from '../Schema'")
        expect(await readFile(path.join(outDir, 'src', 'Apis', 'ActiveCustomer.ts'), 'utf8')).not.toContain('import type { Active,')
        expect(await readFile(path.join(outDir, 'src', 'Apis', 'ActiveCustomer.ts'), 'utf8')).not.toContain('CustomerHeader')
        expect(await readFile(path.join(outDir, 'src', 'index.ts'), 'utf8')).toContain("export { ActiveCustomer as ActiveCustomerApi } from './Apis/ActiveCustomer'")
    }, 30000)
})