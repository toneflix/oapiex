import { OperationTypeRefs, SdkManifest, SdkNamingStrategyOptions, SdkSecurityRequirementManifest, SdkSecuritySchemeManifest } from './types'

import type { OpenApiDocumentLike } from '../types/open-api'
import { TypeBuilder } from './TypeBuilder'
import { TypeScriptGenerator } from './TypeScriptGenerator'
import { execFileSync } from 'node:child_process'

export interface SdkPackageGeneratorOptions extends SdkNamingStrategyOptions {
    outputMode?: 'runtime' | 'classes' | 'both'
    signatureStyle?: 'flat' | 'grouped'
    rootTypeName?: string
    schemaModule?: string
    packageName?: string
    packageVersion?: string
    packageDescription?: string
    sdkKitPackageName?: string
}

export class SdkPackageGenerator {
    private static publishedPackageVersionRanges = new Map<string, string>()

    private typeBuilder = new TypeBuilder()
    private typeScriptGenerator = new TypeScriptGenerator()

    generate (
        document: OpenApiDocumentLike,
        options: SdkPackageGeneratorOptions = {}
    ): Record<string, string> {
        const outputMode = options.outputMode ?? 'both'
        const signatureStyle = options.signatureStyle ?? 'grouped'
        const rootTypeName = options.rootTypeName ?? 'ExtractedApiDocument'
        const schemaModule = options.schemaModule
            ?? this.typeScriptGenerator.generateModule(document, rootTypeName, options)
        const operationTypeRefs = this.createOperationTypeRefs(document)
        const manifest = this.typeBuilder.buildSdkManifest(document, operationTypeRefs, options)
        const classNames = manifest.groups.map((group) => group.className)
        const files: Record<string, string> = {
            'package.json': this.renderPackageJson(options),
            'README.md': this.renderReadme(manifest, options, outputMode, signatureStyle),
            'src/Schema.ts': schemaModule,
            'src/index.ts': this.renderIndexFile(classNames, outputMode, rootTypeName, manifest),
            'tsconfig.json': this.renderTsconfig(),
            'tsdown.config.ts': this.renderTsdownConfig(),
            'vitest.config.ts': this.renderVitestConfig(),
            'tests/exports.test.ts': this.renderExportsTest(rootTypeName, outputMode),
        }

        if (outputMode !== 'runtime') {
            files['src/BaseApi.ts'] = this.renderBaseApi()
            files['src/ApiBinder.ts'] = this.renderApiBinder(manifest)

            for (const group of manifest.groups) {
                files[`src/Apis/${group.className}.ts`] = this.renderApiClass(group, signatureStyle)
            }

            files['src/Core.ts'] = this.renderCoreFile()
        }

        return files
    }

    private createOperationTypeRefs (document: OpenApiDocumentLike): Map<string, OperationTypeRefs> {
        const context = this.typeBuilder.createContext()
        const operationTypeRefs = new Map<string, OperationTypeRefs>()

        for (const model of this.typeBuilder.collectSemanticModels(document)) {
            const operationKey = `${model.path}::${model.method}`
            const resolvedName = this.typeBuilder.registerNamedShape(
                this.typeBuilder.namespaceTopLevelShape(model.shape, model.role),
                model.name,
                context,
                model.collisionSuffix,
            )
            const existingRefs = operationTypeRefs.get(operationKey) ?? {
                response: 'Record<string, never>',
                responseExample: 'unknown',
                input: 'Record<string, never>',
                query: 'Record<string, never>',
                header: 'Record<string, never>',
                params: 'Record<string, never>',
            }

            existingRefs[model.role] = resolvedName
            operationTypeRefs.set(operationKey, existingRefs)
        }

        return operationTypeRefs
    }

    private renderBaseApi (): string {
        return [
            'import { BaseApi as KitBaseApi } from \'@oapiex/sdk-kit\'',
            '',
            'export class BaseApi extends KitBaseApi {}',
        ].join('\n')
    }

    private renderApiBinder (manifest: ReturnType<TypeBuilder['buildSdkManifest']>): string {
        return [
            'import { BaseApi } from \'./BaseApi\'',
            '',
            ...manifest.groups.map((group) => `import { ${group.className} } from './Apis/${group.className}'`),
            '',
            'export class ApiBinder extends BaseApi {',
            ...manifest.groups.map((group) => `    ${group.propertyName}!: ${group.className}`),
            '',
            '    protected override boot () {',
            ...manifest.groups.map((group) => `        this.${group.propertyName} = new ${group.className}(this.core)`),
            '    }',
            '}',
        ].join('\n')
    }

    private renderApiClass (
        group: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number],
        signatureStyle: 'flat' | 'grouped'
    ): string {
        const typeImportContext = this.createTypeImportContext(group, signatureStyle)

        const imports = [
            "import { BaseApi } from '../BaseApi'",
        ]

        if (typeImportContext.specifiers.length > 0) {
            imports.splice(1, 0, `import type { ${typeImportContext.specifiers.join(', ')} } from '../Schema'`)
        }

        return [
            ...imports,
            '',
            `export class ${group.className} extends BaseApi {`,
            '',
            ...group.operations.flatMap((operation) => [
                this.renderApiMethod(operation, signatureStyle, typeImportContext.aliasMap),
                '',
            ]).slice(0, -1),
            '}',
        ].join('\n')
    }

    private renderApiMethod (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        signatureStyle: 'flat' | 'grouped',
        aliasMap: Map<string, string>
    ): string {
        const signature = signatureStyle === 'flat'
            ? this.renderFlatSignature(operation, aliasMap)
            : this.renderGroupedSignature(operation, aliasMap)
        const urlPathArgs = signatureStyle === 'flat'
            ? this.renderFlatObjectLiteral(operation.paramsType, operation.pathParams)
            : operation.pathParams.length > 0 ? 'params' : '{}'
        const urlQueryArgs = signatureStyle === 'flat'
            ? this.renderFlatObjectLiteral(operation.queryType, operation.queryParams)
            : operation.queryParams.length > 0 ? 'query' : '{}'
        const headerArgs = signatureStyle === 'flat'
            ? this.renderFlatHeaders(operation)
            : operation.headerParams.length > 0
                ? '((headers ? { ...headers } : {}) as Record<string, string | undefined>)'
                : '{}'
        const bodyArg = signatureStyle === 'flat'
            ? (operation.hasBody ? 'body' : '{}')
            : (operation.hasBody ? 'body ?? {}' : '{}')
        const docComment = this.renderMethodDocComment(operation, signatureStyle, aliasMap)

        return [
            ...(docComment ? [docComment] : []),
            `    async ${operation.methodName} ${signature}: Promise<${this.rewriteTypeReference(operation.responseType, aliasMap)}> {`,
            '        await this.core.validateAccess()',
            '',
            // Send through the client's own scoped HTTP so several generated SDKs
            // can share a process without sharing base URLs or credentials.
            `        const { data } = await this.core.http.send<${this.rewriteTypeReference(operation.responseType, aliasMap)}>(`,
            `            this.core.builder.buildTargetUrl('${operation.path}', ${urlPathArgs}, ${urlQueryArgs}),`,
            `            '${operation.method}',`,
            `            ${bodyArg},`,
            `            ${headerArgs}`,
            '        )',
            '',
            '        return data',
            '    }',
        ].join('\n')
    }

    private renderMethodDocComment (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        signatureStyle: 'flat' | 'grouped',
        aliasMap: Map<string, string>
    ): string {
        const lines: string[] = []
        const summary = operation.summary?.trim()
        const description = operation.description?.trim()
        const operationId = operation.operationId?.trim()
        const responseType = this.rewriteTypeReference(operation.responseType, aliasMap)
        const responseDescription = operation.responseDescription?.trim()

        if (summary) {
            lines.push(summary)
        }

        if (description && description !== summary) {
            if (lines.length > 0) {
                lines.push('')
            }

            lines.push(...this.wrapDocText(description))
        }

        const metadataLines = [
            `HTTP ${operation.method} ${operation.path}`,
            ...(operationId ? [`Operation ID: ${operationId}`] : []),
        ]

        if (metadataLines.length > 0) {
            if (lines.length > 0) {
                lines.push('')
            }

            lines.push(...metadataLines)
        }

        const parameterDocs = signatureStyle === 'flat'
            ? this.renderFlatParameterDocs(operation, aliasMap)
            : this.renderGroupedParameterDocs(operation, aliasMap)

        if (parameterDocs.length > 0) {
            if (lines.length > 0) {
                lines.push('')
            }

            lines.push(...parameterDocs)
        }

        lines.push(`@returns ${responseDescription ? `${responseDescription} ` : ''}${responseType}`.trim())

        return [
            '    /**',
            ...lines.map((line) => line ? `     * ${line}` : '     *'),
            '     */',
        ].join('\n')
    }

    private renderGroupedParameterDocs (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        aliasMap: Map<string, string>
    ): string[] {
        const docs: string[] = []

        if (operation.pathParams.length > 0) {
            docs.push(this.renderParamDoc('params', operation.paramsType, aliasMap, this.describeParameterGroup(operation.pathParams, 'path parameters')))
        }

        if (operation.queryParams.length > 0) {
            docs.push(this.renderParamDoc('query', operation.queryType, aliasMap, this.describeParameterGroup(operation.queryParams, 'query parameters')))
        }

        if (operation.hasBody) {
            docs.push(this.renderParamDoc('body', operation.inputType, aliasMap, operation.requestBodyDescription?.trim() || 'Request body'))
        }

        if (operation.headerParams.length > 0) {
            docs.push(this.renderParamDoc('headers', operation.headerType, aliasMap, this.describeParameterGroup(operation.headerParams, 'request headers')))
        }

        return docs
    }

    private renderFlatParameterDocs (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        aliasMap: Map<string, string>
    ): string[] {
        const docs = [
            ...operation.pathParams.map((parameter) => this.renderParamDoc(parameter.accessor, `${operation.paramsType}[${JSON.stringify(parameter.name)}]`, aliasMap, parameter.description?.trim() || `Path parameter ${parameter.name}`)),
            ...operation.queryParams.map((parameter) => this.renderParamDoc(parameter.accessor, `${operation.queryType}[${JSON.stringify(parameter.name)}]`, aliasMap, parameter.description?.trim() || `Query parameter ${parameter.name}`)),
            ...(operation.hasBody ? [this.renderParamDoc('body', operation.inputType, aliasMap, operation.requestBodyDescription?.trim() || 'Request body')] : []),
            ...operation.headerParams.map((parameter) => this.renderParamDoc(parameter.accessor, `${operation.headerType}[${JSON.stringify(parameter.name)}]`, aliasMap, parameter.description?.trim() || `Header ${parameter.name}`)),
        ]

        return docs
    }

    private renderParamDoc (name: string, typeRef: string, aliasMap: Map<string, string>, description: string): string {
        const renderedType = this.rewriteTypeReference(typeRef, aliasMap)

        return `@param ${name} ${description} Type: ${renderedType}`
    }

    private describeParameterGroup (
        parameters: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number]['pathParams'],
        fallback: string
    ): string {
        const described = parameters
            .map((parameter) => parameter.description?.trim() ? `${parameter.name}: ${parameter.description.trim()}` : parameter.name)
            .filter(Boolean)

        if (described.length === 0) {
            return fallback
        }

        return described.join('; ')
    }

    private wrapDocText (text: string): string[] {
        return text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
    }

    private renderGroupedSignature (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        aliasMap: Map<string, string>
    ): string {
        const args: string[] = []

        if (operation.pathParams.length > 0) {
            args.push(`params: ${this.rewriteTypeReference(operation.paramsType, aliasMap)}`)
        }

        if (operation.queryParams.length > 0) {
            args.push(`query: ${this.rewriteTypeReference(operation.queryType, aliasMap)}`)
        }

        if (operation.hasBody) {
            args.push(`body${operation.bodyRequired ? '' : '?'}: ${this.rewriteTypeReference(operation.inputType, aliasMap)}`)
        }

        if (operation.headerParams.length > 0) {
            args.push(`headers?: ${this.rewriteTypeReference(operation.headerType, aliasMap)}`)
        }

        return `(${args.join(', ')})`
    }

    private renderFlatSignature (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number],
        aliasMap: Map<string, string>
    ): string {
        const args = [
            ...operation.pathParams.map((parameter) => `${parameter.accessor}${parameter.required ? '' : '?'}: ${this.rewriteTypeReference(operation.paramsType, aliasMap)}[${JSON.stringify(parameter.name)}]`),
            ...operation.queryParams.map((parameter) => `${parameter.accessor}${parameter.required ? '' : '?'}: ${this.rewriteTypeReference(operation.queryType, aliasMap)}[${JSON.stringify(parameter.name)}]`),
            ...(operation.hasBody ? [`body${operation.bodyRequired ? '' : '?'}: ${this.rewriteTypeReference(operation.inputType, aliasMap)}`] : []),
            ...operation.headerParams.map((parameter) => `${parameter.accessor}${parameter.required ? '' : '?'}: ${this.rewriteTypeReference(operation.headerType, aliasMap)}[${JSON.stringify(parameter.name)}]`),
        ]

        return `(${args.join(', ')})`
    }

    private createTypeImportContext (
        group: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number],
        signatureStyle: 'flat' | 'grouped'
    ): { specifiers: string[], aliasMap: Map<string, string> } {
        const requiredTypeRefs = new Set<string>()

        for (const operation of group.operations) {
            requiredTypeRefs.add(operation.responseType)

            if (operation.hasBody) {
                requiredTypeRefs.add(operation.inputType)
            }

            if (operation.queryParams.length > 0) {
                requiredTypeRefs.add(operation.queryType)
            }

            if (operation.headerParams.length > 0) {
                requiredTypeRefs.add(operation.headerType)
            }

            if (operation.pathParams.length > 0) {
                requiredTypeRefs.add(operation.paramsType)
            }

            if (signatureStyle === 'flat') {
                continue
            }
        }

        const identifiers = Array.from(new Set(Array.from(requiredTypeRefs).flatMap((typeRef) => this.collectTypeIdentifiers(typeRef)))).sort()
        const aliasMap = new Map<string, string>()
        const specifiers = identifiers.map((identifier) => {
            if (identifier === group.className) {
                const aliasedName = `${identifier}Model`

                aliasMap.set(identifier, aliasedName)

                return `${identifier} as ${aliasedName}`
            }

            return identifier
        })

        return {
            specifiers,
            aliasMap,
        }
    }

    private rewriteTypeReference (typeRef: string, aliasMap: Map<string, string>): string {
        let rewritten = typeRef

        for (const [identifier, alias] of aliasMap.entries()) {
            rewritten = rewritten.replace(new RegExp(`\\b${identifier}\\b`, 'g'), alias)
        }

        return rewritten
    }

    private renderFlatObjectLiteral (_typeName: string, parameters: Array<{ name: string, accessor: string }>): string {
        if (parameters.length === 0) {
            return '{}'
        }

        return `{ ${parameters.map((parameter) => `${JSON.stringify(parameter.name)}: ${parameter.accessor}`).join(', ')} }`
    }

    private renderFlatHeaders (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number]
    ): string {
        if (operation.headerParams.length === 0) {
            return '{}'
        }

        return `({ ${operation.headerParams.map((parameter) => `${JSON.stringify(parameter.name)}: ${parameter.accessor}`).join(', ')} } as Record<string, string | undefined>)`
    }

    private renderCoreFile (): string {
        return [
            "import { Core as KitCore } from '@oapiex/sdk-kit'",
            '',
            "import { ApiBinder } from './ApiBinder'",
            '',
            'export class Core extends KitCore {',
            '    static override apiClass = ApiBinder',
            '',
            '    declare api: ApiBinder',
            '}',
        ].join('\n')
    }

    private renderPackageJson (options: SdkPackageGeneratorOptions): string {
        const sdkKitPackageName = options.sdkKitPackageName ?? '@oapiex/sdk-kit'

        return JSON.stringify({
            name: options.packageName ?? 'generated-sdk',
            type: 'module',
            version: options.packageVersion ?? '0.1.0',
            private: true,
            description: options.packageDescription ?? 'Generated SDK scaffold emitted by oapiex.',
            main: './dist/index.cjs',
            module: './dist/index.js',
            types: './dist/index.d.ts',
            exports: {
                '.': {
                    import: './dist/index.js',
                    require: './dist/index.cjs',
                },
                './package.json': './package.json',
            },
            files: [
                'dist',
            ],
            scripts: {
                test: 'pnpm vitest --run',
                'test:watch': 'pnpm vitest',
                build: 'tsdown',
            },
            dependencies: {
                '@h3ravel/shared': this.resolvePublishedPackageVersionRange('@h3ravel/shared'),
                [sdkKitPackageName]: this.resolvePublishedPackageVersionRange(sdkKitPackageName),
            },
            devDependencies: {
                '@types/node': '^25.8.0',
                tsdown: '^0.22.0',
                typescript: '^6.0.3',
                vitest: '^4.1.6',
            },
        }, null, 2)
    }

    /**
     * Attempts to resolve the published version range for the given package name by querying npm.
     * If the package is not found or an error occurs, it falls back to a default version range.
     * 
     * @param packageName The name of the npm package to query.
     * @returns           The resolved version range for the package.
     */
    private resolvePublishedPackageVersionRange (packageName: string): string {
        const cached = SdkPackageGenerator.publishedPackageVersionRanges.get(packageName)

        if (cached) {
            return cached
        }

        try {
            const version = JSON.parse(execFileSync('npm', ['view', packageName, 'version', '--json'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            })) as string

            if (typeof version === 'string' && version.trim().length > 0) {
                const versionRange = `^${version.trim()}`

                SdkPackageGenerator.publishedPackageVersionRanges.set(packageName, versionRange)

                return versionRange
            }
        } catch {
            SdkPackageGenerator.publishedPackageVersionRanges.set(packageName, 'latest')
        }

        return 'latest'
    }

    private renderReadme (
        manifest: ReturnType<TypeBuilder['buildSdkManifest']>,
        options: SdkPackageGeneratorOptions,
        outputMode: 'runtime' | 'classes' | 'both',
        signatureStyle: 'flat' | 'grouped'
    ): string {
        const packageName = options.packageName ?? 'generated-sdk'
        const title = `# ${packageName}`
        const description = this.renderReadmeDescription(outputMode)
        const usage = this.renderReadmeUsage(manifest, packageName, outputMode, signatureStyle)
        const exports = this.renderReadmeExports(outputMode, manifest)

        return [
            title,
            '',
            description,
            '',
            '## Install',
            '',
            '```bash',
            `pnpm add ${packageName}`,
            '```',
            '',
            '## Quick Start',
            '',
            '```ts',
            usage,
            '```',
            '',
            '## Main Exports',
            '',
            ...exports.map((line) => `- ${line}`),
            '',
            '## Commands',
            '',
            '```bash',
            'pnpm test',
            'pnpm build',
            '```',
        ].join('\n')
    }

    private renderReadmeDescription (outputMode: 'runtime' | 'classes' | 'both'): string {
        if (outputMode === 'runtime') {
            return 'Generated runtime-first TypeScript SDK emitted by oapiex.'
        }

        if (outputMode === 'classes') {
            return 'Generated class-based TypeScript SDK emitted by oapiex.'
        }

        return 'Generated TypeScript SDK emitted by oapiex with both class-based and runtime-first entrypoints.'
    }

    private renderReadmeUsage (
        manifest: ReturnType<TypeBuilder['buildSdkManifest']>,
        packageName: string,
        outputMode: 'runtime' | 'classes' | 'both',
        signatureStyle: 'flat' | 'grouped'
    ): string {
        const exampleOperation = this.pickExampleOperation(manifest)
        const runtimeSnippet = this.renderReadmeClientSnippet(packageName, 'runtime', signatureStyle, exampleOperation)

        if (outputMode === 'runtime') {
            return runtimeSnippet
        }

        const classSnippet = this.renderReadmeClientSnippet(packageName, 'classes', signatureStyle, exampleOperation)

        if (outputMode === 'classes') {
            return classSnippet
        }

        const typeImports = exampleOperation ? this.collectReadmeTypeImports(exampleOperation.operation) : []
        const helperImports = exampleOperation ? this.collectReadmeAuthHelperImports(exampleOperation) : []
        const valueImports = ['Core', 'createClient', ...helperImports]
        const importLine = typeImports.length > 0
            ? `import { ${valueImports.join(', ')}, type ${typeImports.join(', type ')} } from '${packageName}'`
            : `import { ${valueImports.join(', ')} } from '${packageName}'`

        return [
            importLine,
            '',
            ...this.renderReadmeClientBody('sdk', 'classes', signatureStyle, exampleOperation),
            '',
            '// --- OR ---',
            '',
            ...this.renderReadmeClientBody('runtimeSdk', 'runtime', signatureStyle, exampleOperation),
        ].join('\n')
    }

    private renderReadmeClientSnippet (
        packageName: string,
        mode: 'runtime' | 'classes',
        signatureStyle: 'flat' | 'grouped',
        exampleOperation: ReturnType<SdkPackageGenerator['pickExampleOperation']>
    ): string {
        const importNames = mode === 'runtime' ? ['createClient'] : ['Core']
        const typeImports = exampleOperation ? this.collectReadmeTypeImports(exampleOperation.operation) : []
        const helperImports = exampleOperation ? this.collectReadmeAuthHelperImports(exampleOperation) : []
        const valueImports = [...importNames, ...helperImports]
        const importLine = typeImports.length > 0
            ? `import { ${valueImports.join(', ')}, type ${typeImports.join(', type ')} } from '${packageName}'`
            : `import { ${valueImports.join(', ')} } from '${packageName}'`
        const sdkVariable = mode === 'runtime' ? 'runtimeSdk' : 'sdk'

        return [
            importLine,
            '',
            ...this.renderReadmeClientBody(sdkVariable, mode, signatureStyle, exampleOperation),
        ].join('\n')
    }

    private renderReadmeClientBody (
        sdkVariable: string,
        mode: 'runtime' | 'classes',
        signatureStyle: 'flat' | 'grouped',
        exampleOperation: ReturnType<SdkPackageGenerator['pickExampleOperation']>
    ): string[] {
        const initLine = mode === 'runtime'
            ? `const ${sdkVariable} = createClient({`
            : `const ${sdkVariable} = new Core({`
        const callLines = exampleOperation
            ? this.renderReadmeOperationCall(sdkVariable, exampleOperation, mode === 'runtime' ? 'grouped' : signatureStyle)
            : []
        const authLines = exampleOperation
            ? this.renderReadmeAuthLines(exampleOperation.operation.security ?? exampleOperation.groupSecurity ?? exampleOperation.globalSecurity)
            : []

        return [
            initLine,
            '  clientId: process.env.CLIENT_ID!,',
            '  clientSecret: process.env.CLIENT_SECRET!,',
            "  environment: 'sandbox',",
            ...authLines,
            '})',
            ...(callLines.length > 0 ? ['', ...callLines] : []),
        ]
    }

    private renderReadmeExports (
        outputMode: 'runtime' | 'classes' | 'both',
        manifest: SdkManifest
    ): string[] {
        const authLine = manifest.securitySchemes.length > 0
            ? ['generated auth helpers derived from OpenAPI security schemes']
            : []

        if (outputMode === 'runtime') {
            return [
                '`createClient()` for a typed runtime SDK instance',
                ...authLine,
                '`Schema` exports for request, response, params, query, and header types',
            ]
        }

        if (outputMode === 'classes') {
            return [
                '`Core` as the class-based SDK entrypoint',
                ...authLine,
                'generated API classes plus `Schema` type exports',
            ]
        }

        return [
            '`Core` for class-based usage',
            '`createClient()` for runtime-first usage',
            ...authLine,
            '`Schema` exports for generated request, response, params, query, and header types',
        ]
    }

    private pickExampleOperation (manifest: ReturnType<TypeBuilder['buildSdkManifest']>) {
        const group = manifest.groups[0]
        const operation = group?.operations[0]

        if (!group || !operation) {
            return null
        }

        return {
            group,
            operation,
            groupSecurity: undefined,
            globalSecurity: manifest.security,
        }
    }

    private renderReadmeAuthLines (security?: SdkSecurityRequirementManifest[]): string[] {
        if (!security || security.length === 0) {
            return []
        }

        const selectedRequirement = security[0]

        if (!selectedRequirement || selectedRequirement.schemes.length === 0) {
            return []
        }

        const value = selectedRequirement.schemes.length === 1
            ? this.renderReadmeAuthFactoryCall(selectedRequirement.schemes[0].name)
            : `[
    ${selectedRequirement.schemes.map((scheme) => this.renderReadmeAuthFactoryCall(scheme.name)).join(',\n    ')}
  ]`
        const lines = security.length > 1
            ? ['  // Choose a generated auth helper that matches your API access setup.']
            : []

        lines.push(`  auth: ${value},`)

        return lines
    }

    private renderReadmeAuthFactoryCall (schemeName: string): string {
        const helperName = this.createSecurityHelperName(schemeName)
        const envName = this.toConstantCase(schemeName)

        if (/basic/i.test(schemeName)) {
            return `${helperName}(process.env.${envName}_USERNAME!, process.env.${envName}_PASSWORD!)`
        }

        return `${helperName}(process.env.${envName}_VALUE!)`
    }

    private collectReadmeAuthHelperImports (
        exampleOperation: NonNullable<ReturnType<SdkPackageGenerator['pickExampleOperation']>>
    ): string[] {
        const security = exampleOperation.operation.security ?? exampleOperation.groupSecurity ?? exampleOperation.globalSecurity
        const selectedRequirement = security?.[0]

        if (!selectedRequirement) {
            return []
        }

        return selectedRequirement.schemes.map((scheme) => this.createSecurityHelperName(scheme.name))
    }

    private collectReadmeTypeImports (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number]
    ): string[] {
        const types = new Set<string>()

        if (operation.pathParams.length > 0) {
            types.add(operation.paramsType)
        }

        if (operation.queryParams.length > 0) {
            types.add(operation.queryType)
        }

        if (operation.hasBody) {
            types.add(operation.inputType)
        }

        if (operation.headerParams.length > 0) {
            types.add(operation.headerType)
        }

        return Array.from(types).sort()
    }

    private renderReadmeOperationCall (
        sdkVariable: string,
        exampleOperation: NonNullable<ReturnType<SdkPackageGenerator['pickExampleOperation']>>,
        signatureStyle: 'flat' | 'grouped'
    ): string[] {
        const { group, operation } = exampleOperation
        const args = signatureStyle === 'flat'
            ? this.renderReadmeFlatArgs(operation)
            : this.renderReadmeGroupedArgs(operation)

        return [
            `await ${sdkVariable}.api.${group.propertyName}.${operation.methodName}(`,
            ...args.map((arg) => `  ${arg},`),
            ')',
        ]
    }

    private renderReadmeGroupedArgs (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number]
    ): string[] {
        const args: string[] = []

        if (operation.pathParams.length > 0) {
            args.push(`{} as ${operation.paramsType}`)
        }

        if (operation.queryParams.length > 0) {
            args.push(`{} as ${operation.queryType}`)
        }

        if (operation.hasBody) {
            args.push(`{} as ${operation.inputType}`)
        }

        if (operation.headerParams.length > 0) {
            args.push(`{} as ${operation.headerType}`)
        }

        return args
    }

    private renderReadmeFlatArgs (
        operation: ReturnType<TypeBuilder['buildSdkManifest']>['groups'][number]['operations'][number]
    ): string[] {
        return [
            ...operation.pathParams.map((parameter) => `{} as ${operation.paramsType}[${JSON.stringify(parameter.name)}]`),
            ...operation.queryParams.map((parameter) => `{} as ${operation.queryType}[${JSON.stringify(parameter.name)}]`),
            ...(operation.hasBody ? [`{} as ${operation.inputType}`] : []),
            ...operation.headerParams.map((parameter) => `{} as ${operation.headerType}[${JSON.stringify(parameter.name)}]`),
        ]
    }

    private renderTsconfig (): string {
        return JSON.stringify({
            compilerOptions: {
                rootDir: '.',
                outDir: './dist',
                target: 'esnext',
                module: 'es2022',
                moduleResolution: 'bundler',
                esModuleInterop: true,
                strict: true,
                allowJs: true,
                skipLibCheck: true,
                resolveJsonModule: true,
            },
            include: ['./src/**/*', './tests/**/*'],
            exclude: ['./dist', './node_modules'],
        }, null, 2)
    }

    private renderTsdownConfig (): string {
        return [
            "import { defineConfig } from 'tsdown'",
            '',
            'export default defineConfig({',
            '    entry: {',
            "        index: 'src/index.ts',",
            '    },',
            '    exports: true,',
            "    format: ['esm', 'cjs'],",
            "    outDir: 'dist',",
            '    dts: true,',
            '    sourcemap: false,',
            "    external: ['@oapiex/sdk-kit'],",
            '    clean: true,',
            '})',
        ].join('\n')
    }

    private renderVitestConfig (): string {
        return [
            "import { defineConfig } from 'vitest/config'",
            '',
            'export default defineConfig({',
            '    test: {',
            "        name: 'generated-sdk',",
            "        environment: 'node',",
            "        include: ['tests/*.{test,spec}.?(c|m)[jt]s?(x)'],",
            '    },',
            '})',
        ].join('\n')
    }

    private renderExportsTest (rootTypeName: string, outputMode: 'runtime' | 'classes' | 'both'): string {
        const rootExportName = `${rootTypeName.charAt(0).toLowerCase()}${rootTypeName.slice(1)}`
        const assertions = [
            "        expect(sdk.createClient).toBeTypeOf('function')",
            "        expect(sdk.createSdk).toBeTypeOf('function')",
            "        expect(sdk.setConfigFileBasename).toBeTypeOf('function')",
            `        expect(sdk.${rootExportName}Sdk).toBeDefined()`,
            `        expect(sdk.${rootExportName}Manifest).toBeDefined()`,
        ]

        if (outputMode !== 'runtime') {
            assertions.unshift("        expect(sdk.Core).toBeTypeOf('function')")
            assertions.unshift("        expect(sdk.BaseApi).toBeTypeOf('function')")
        }

        return [
            "import { describe, expect, it } from 'vitest'",
            '',
            "import * as sdk from '../src/index'",
            '',
            "describe('generated sdk exports', () => {",
            "    it('exposes the generated schema and runtime helpers', () => {",
            ...assertions,
            '    })',
            '})',
        ].join('\n')
    }

    private renderIndexFile (
        classNames: string[],
        outputMode: 'runtime' | 'classes' | 'both',
        rootTypeName: string,
        manifest: SdkManifest
    ): string {
        const rootExportName = `${rootTypeName.charAt(0).toLowerCase()}${rootTypeName.slice(1)}`
        const lines = [
            `import type { ${rootTypeName}Api } from './Schema'`,
            `import { ${rootExportName}Manifest, ${rootExportName}Sdk } from './Schema'`,
            "import { createSdk as createBoundSdk } from '@oapiex/sdk-kit'",
            "import type { AuthConfig, BaseApi as KitBaseApi, Core as KitCore, InitOptions } from '@oapiex/sdk-kit'",
            '',
            "export * from './Schema'",
        ]

        if (outputMode !== 'runtime') {
            lines.push("export { ApiBinder } from './ApiBinder'")
            lines.push("export { BaseApi } from './BaseApi'")
            lines.push(...classNames.map((className) => `export { ${className} as ${className}Api } from './Apis/${className}'`))
            lines.push("export { Core } from './Core'")
        }

        lines.push('')
        lines.push(`export const securitySchemes = ${rootExportName}Manifest.securitySchemes`)
        lines.push(`export const security = ${rootExportName}Manifest.security`)

        if (manifest.securitySchemes.length > 0) {
            lines.push('')

            for (const scheme of manifest.securitySchemes) {
                lines.push(...this.renderSecurityHelper(scheme))
                lines.push('')
            }
        }

        lines.push('export const createClient = (')
        lines.push('    options: InitOptions')
        lines.push(`): KitCore & { api: KitBaseApi & ${rootTypeName}Api } =>`)
        lines.push(`    createBoundSdk(${rootExportName}Sdk, options) as KitCore & { api: KitBaseApi & ${rootTypeName}Api }`)
        lines.push('')
        lines.push('export {')
        lines.push('    BadRequestException,')
        lines.push('    Builder,')
        lines.push('    ForbiddenRequestException,')
        lines.push('    Http,')
        lines.push('    HttpException,')
        lines.push('    setConfigFileBasename,')
        lines.push('    UnauthorizedRequestException,')
        lines.push('    WebhookValidator,')
        lines.push('    createSdk,')
        lines.push('} from \'@oapiex/sdk-kit\'')
        lines.push('')
        lines.push('export type {')
        lines.push('    AuthConfig,')
        lines.push('    InitOptions,')
        lines.push('    UnifiedResponse,')
        lines.push('    XGenericObject,')
        lines.push('} from \'@oapiex/sdk-kit\'')

        return lines.join('\n')
    }

    private collectTypeIdentifiers (typeRef: string): string[] {
        return Array.from(new Set((typeRef.match(/\b[A-Z][A-Za-z0-9_]*/g) ?? []).filter((identifier) => {
            return !['Record', 'Promise'].includes(identifier)
        })))
    }

    private renderSecurityHelper (scheme: SdkSecuritySchemeManifest): string[] {
        if (scheme.authType === 'basic') {
            return [
                `export const ${scheme.helperName} = (username: string, password: string): AuthConfig => ({`,
                "    type: 'basic',",
                '    username,',
                '    password,',
                '})',
            ]
        }

        if (scheme.authType === 'apiKey') {
            return [
                `export const ${scheme.helperName} = (value: string): AuthConfig => ({`,
                "    type: 'apiKey',",
                `    name: ${JSON.stringify(scheme.parameterName ?? scheme.name)},`,
                '    value,',
                `    in: ${JSON.stringify(scheme.in ?? 'header')},`,
                '})',
            ]
        }

        if (scheme.authType === 'oauth2') {
            return [
                `export const ${scheme.helperName} = (accessToken: string, tokenType = 'Bearer'): AuthConfig => ({`,
                "    type: 'oauth2',",
                '    accessToken,',
                '    tokenType,',
                '})',
            ]
        }

        return [
            `export const ${scheme.helperName} = (token: string): AuthConfig => ({`,
            "    type: 'bearer',",
            '    token,',
            ...(scheme.scheme && scheme.scheme.toLowerCase() !== 'bearer'
                ? [`    prefix: ${JSON.stringify(this.normalizeHttpAuthPrefix(scheme.scheme))},`]
                : []),
            '})',
        ]
    }

    private createSecurityHelperName (schemeName: string): string {
        const sanitized = this.typeBuilder.sanitizeTypeName(schemeName)

        return sanitized.endsWith('Auth')
            ? `create${sanitized}`
            : `create${sanitized}Auth`
    }

    private normalizeHttpAuthPrefix (scheme: string): string {
        return scheme.charAt(0).toUpperCase() + scheme.slice(1)
    }

    private toConstantCase (value: string): string {
        return value
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[^A-Za-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase() || 'AUTH'
    }
}