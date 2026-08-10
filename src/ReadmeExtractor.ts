import { AttributeQueryNode, AttributedNode, QueryableNode, ReadmeCodeSnippet, ReadmeOperation, ReadmeParameter, ReadmeResponseBody, ReadmeResponseSchema, ReadmeSidebarLink, TextNodeLike } from './types/base'
import { OpenApiMediaType, OpenApiOperationLike, OpenApiResponse, OpenApiSchema } from './types/open-api'

import type { Element as HappyDomElement } from 'happy-dom'
import { JsonRepair } from './JsonRepair'
import { Window } from 'happy-dom'
import { isRecord } from './Core'

export const extractReadmeOperationFromHtml = (html: string): ReadmeOperation => {
    const window = new Window()

    try {
        window.document.write(html)

        return extractReadmeOperationFromWindow(window)
    } finally {
        void window.happyDOM.close()
    }
}

export const extractReadmeOperationFromHtmlAsync = async (html: string): Promise<ReadmeOperation> => {
    const window = new Window()

    try {
        window.document.write(html)

        return extractReadmeOperationFromWindow(window)
    } finally {
        await window.happyDOM.close()
    }
}

const extractReadmeOperationFromWindow = (window: Window): ReadmeOperation => {
    const { document } = window
    const contentRoot = document.querySelector('article#content') ?? document.body
    const requestParamsForm = contentRoot.querySelector('form[name="Parameters"]')
    const requestPlayground = document.querySelector('.rm-PlaygroundRequest')
    const responsePlayground = document.querySelector('.rm-PlaygroundResponse')
    const requestCodeSnippets = extractRequestCodeSnippets(requestPlayground)
    const requestExampleNormalized = normalizeRequestCodeSnippet(requestCodeSnippets[0] ?? null)
    const responseBodies = extractResponseBodies(responsePlayground)
    const extractedOperation: ReadmeOperation = {
        method: readText(contentRoot.querySelector('[data-testid="http-method"]'))?.toUpperCase() ?? null,
        url: readText(contentRoot.querySelector('[data-testid="serverurl"]')),
        description: extractOperationDescription(contentRoot),
        sidebarLinks: extractSidebarLinks(document.querySelector('.rm-Sidebar.hub-sidebar-content')),
        requestParams: extractRequestParams(requestParamsForm),
        requestCodeSnippets,
        requestExample: requestCodeSnippets[0]?.body ?? null,
        requestExampleNormalized,
        responseSchemas: extractResponseSchemas(contentRoot),
        responseBodies,
        responseExample: responseBodies[0]?.body ?? null,
        responseExampleRaw: responseBodies[0]?.rawBody ?? null,
    }
    const ssrPropsOperation = extractReadmeOperationFromSsrProps(document)

    return mergeReadmeOperations(extractedOperation, ssrPropsOperation)
}

export const mergeReadmeOperations = (
    primary: ReadmeOperation,
    fallback: ReadmeOperation | null
): ReadmeOperation => {
    if (!fallback) {
        return primary
    }

    return {
        method: primary.method ?? fallback.method,
        url: primary.url ?? fallback.url,
        description: primary.description ?? fallback.description,
        sidebarLinks: primary.sidebarLinks.length > 0 ? primary.sidebarLinks : fallback.sidebarLinks,
        requestParams: primary.requestParams.length > 0 ? primary.requestParams : fallback.requestParams,
        requestCodeSnippets: primary.requestCodeSnippets.length > 0 ? primary.requestCodeSnippets : fallback.requestCodeSnippets,
        requestExample: primary.requestExample ?? fallback.requestExample,
        requestExampleNormalized: primary.requestExampleNormalized ?? fallback.requestExampleNormalized,
        responseSchemas: primary.responseSchemas.length > 0 ? primary.responseSchemas : fallback.responseSchemas,
        responseBodies: primary.responseBodies.length > 0 ? primary.responseBodies : fallback.responseBodies,
        responseExample: primary.responseExample ?? fallback.responseExample,
        responseExampleRaw: primary.responseExampleRaw ?? fallback.responseExampleRaw,
    }
}

export const extractReadmeOperationFromSsrProps = (
    document: Window['document']
): ReadmeOperation | null => {
    const rawSsrProps = document.querySelector('script#ssr-props')?.textContent?.trim()

    if (!rawSsrProps) {
        return null
    }

    let ssrProps: unknown

    try {
        ssrProps = JSON.parse(rawSsrProps)
    } catch {
        return null
    }

    const apiDocument = isRecord(ssrProps) && isRecord(ssrProps.document)
        ? ssrProps.document.api
        : null

    if (!isRecord(apiDocument)) {
        return null
    }

    const method = typeof apiDocument.method === 'string' ? apiDocument.method.toUpperCase() : null
    const path = typeof apiDocument.path === 'string' ? apiDocument.path : null
    const schema = isRecord(apiDocument.schema) ? apiDocument.schema : null
    const operation = resolveSsrOperation(schema, path, method?.toLowerCase() ?? null)
    const serverUrl = Array.isArray(schema?.servers) && isRecord(schema.servers[0]) && typeof schema.servers[0].url === 'string'
        ? schema.servers[0].url
        : null

    if (!operation && !method && !path) {
        return null
    }

    const responseBodies = extractResponseBodiesFromOpenApi(operation?.responses ?? {})

    return {
        method,
        url: buildOperationUrl(serverUrl, path),
        description: operation?.description ?? null,
        sidebarLinks: [],
        requestParams: [
            ...extractOperationParametersFromOpenApi(operation?.parameters),
            ...extractRequestParamsFromOpenApi(operation?.requestBody),
        ],
        requestCodeSnippets: [],
        requestExample: null,
        requestExampleNormalized: null,
        responseSchemas: extractResponseSchemasFromOpenApi(operation?.responses ?? {}),
        responseBodies,
        responseExample: responseBodies[0]?.body ?? null,
        responseExampleRaw: responseBodies[0]?.rawBody ?? null,
    }
}

export const extractOperationParametersFromOpenApi = (
    parameters: OpenApiOperationLike['parameters'] | undefined
): ReadmeParameter[] => {
    if (!parameters) {
        return []
    }

    return parameters.map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        path: [parameter.name],
        type: parameter.schema?.type ?? null,
        required: parameter.required ?? false,
        defaultValue: parameter.schema?.default == null
            ? (parameter.example == null ? null : String(parameter.example))
            : String(parameter.schema.default),
        description: parameter.description ?? parameter.schema?.description ?? null,
    }))
}

export const resolveSsrOperation = (
    schema: Record<string, unknown> | null,
    path: string | null,
    method: string | null
): OpenApiOperationLike | null => {
    if (!schema || !path || !method || !isRecord(schema.paths)) {
        return null
    }

    const pathItem = schema.paths[path]

    if (!isRecord(pathItem) || !isRecord(pathItem[method])) {
        return null
    }

    return pathItem[method] as unknown as OpenApiOperationLike
}

export const buildOperationUrl = (serverUrl: string | null, path: string | null): string | null => {
    if (!serverUrl || !path) {
        return null
    }

    return `${serverUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export const extractRequestParamsFromOpenApi = (
    requestBody: OpenApiOperationLike['requestBody'] | undefined
): ReadmeParameter[] => {
    const schema = requestBody?.content?.['application/json']?.schema

    if (!schema) {
        return []
    }

    return flattenOpenApiSchemaProperties(schema)
}

export const flattenOpenApiSchemaProperties = (
    schema: OpenApiSchema,
    path: string[] = []
): ReadmeParameter[] => {
    if (!schema.properties) {
        return []
    }

    const params: ReadmeParameter[] = []

    for (const [name, property] of Object.entries(schema.properties)) {
        const propertyPath = [...path, name]
        const required = schema.required?.includes(name) ?? false

        if (property.type === 'object' && property.properties) {
            params.push(...flattenOpenApiSchemaProperties(property, propertyPath).map((param) => ({
                ...param,
                required: param.path.length === propertyPath.length + 1 ? required && param.required : param.required,
            })))
            continue
        }

        params.push({
            name,
            in: 'body',
            path: propertyPath,
            type: property.type ?? null,
            required,
            defaultValue: property.default == null ? null : String(property.default),
            description: property.description ?? null,
        })
    }

    return params
}

export const extractResponseSchemasFromOpenApi = (
    responses: Record<string, OpenApiResponse>
): ReadmeResponseSchema[] => {
    return Object.entries(responses).map(([statusCode, response]) => ({
        statusCode,
        description: response.description ?? statusCode,
    }))
}

export const extractResponseBodiesFromOpenApi = (
    responses: Record<string, OpenApiResponse>
): ReadmeResponseBody[] => {
    const bodies: ReadmeResponseBody[] = []

    for (const [statusCode, response] of Object.entries(responses)) {
        for (const [contentType, mediaType] of Object.entries(response.content ?? {})) {
            const example = resolveOpenApiMediaExample(mediaType)

            if (example == null) {
                continue
            }

            const rawBody = typeof example === 'string' ? example : JSON.stringify(example, null, 2)
            const normalized = normalizeResponseBody(rawBody, contentType)

            bodies.push({
                format: normalized.format,
                contentType,
                statusCode,
                label: response.description ?? statusCode,
                body: normalized.body,
                rawBody,
            })
        }
    }

    return bodies
}

export const resolveOpenApiMediaExample = (mediaType: OpenApiMediaType): unknown | null => {
    if (mediaType.example !== undefined) {
        return mediaType.example
    }

    const examples = (mediaType as OpenApiMediaType & {
        examples?: Record<string, { value?: unknown }>
    }).examples

    if (examples && isRecord(examples)) {
        for (const example of Object.values(examples)) {
            if (isRecord(example) && 'value' in example) {
                return example.value ?? null
            }
        }
    }

    if (mediaType.schema?.example !== undefined) {
        return mediaType.schema.example
    }

    return null
}

export const extractOperationDescription = (root: QueryableNode): string | null => {
    const header = root.querySelector('header')

    if (!header) {
        return null
    }

    const markdownBlocks = Array.from(header.querySelectorAll('[data-testid="RDMD"]'))

    return readText(markdownBlocks[markdownBlocks.length - 1] ?? null)
}

export const extractRequestCodeSnippets = (root: QueryableNode | null): ReadmeCodeSnippet[] => {
    if (!root) {
        return []
    }

    const label = extractRequestSnippetLabel(root)

    return extractCodeSnippets(root).map((body) => ({
        label,
        body,
    }))
}

export const extractResponseBodies = (root: QueryableNode | null): ReadmeResponseBody[] => {
    if (!root) {
        return []
    }

    const bodies = extractCodeSnippets(root)
    const contentTypes = extractResponseContentTypes(root)
    const labels = extractResponseLabels(root)

    return bodies.map((body, index) => {
        const label = labels[index] ?? labels[0] ?? null
        const contentType = contentTypes[index] ?? contentTypes[0] ?? null
        const normalized = normalizeResponseBody(body, contentType)

        return {
            format: normalized.format,
            contentType,
            statusCode: label?.match(/\b\d{3}\b/)?.[0] ?? null,
            label,
            body: normalized.body,
            rawBody: body,
        }
    })
}

export const extractSidebarLinks = (root: QueryableNode | null): ReadmeSidebarLink[] => {
    if (!root) {
        return []
    }

    return Array.from(root.querySelectorAll('.rm-Sidebar-link')).map((link) => {
        const section = link.closest('.rm-Sidebar-section')
        const method = readText(link.querySelector('[data-testid="http-method"]'))?.toUpperCase() ?? null

        return {
            section: readText(section?.querySelector('.rm-Sidebar-heading') ?? null),
            label: extractSidebarLinkLabel(link, method),
            href: link.getAttribute('href'),
            method,
            active: link.classList.contains('active') || link.getAttribute('aria-current') === 'page',
            subpage: link.classList.contains('subpage'),
        }
    }).filter((link) => link.label.length > 0)
}

export const extractRequestParams = (root: QueryableNode | null): ReadmeParameter[] => {
    if (!root) {
        return []
    }

    return Array.from(root.querySelectorAll('label')).map((label) => {
        const name = readText(label)
        const param = findParameterRoot(label, root)
        const input = resolveParameterInput(param, label)

        return {
            name: name ?? '',
            in: inferParameterLocation(param, label, root),
            path: inferParameterPath(label, name),
            type: inferParameterType(param, input),
            required: isRequiredParameter(param, input),
            defaultValue: readInputValue(input),
            description: extractParameterDescription(param),
        }
    }).filter((param) => param.name.length > 0)
}

export const extractResponseSchemas = (root: QueryableNode): ReadmeResponseSchema[] => {
    const section = root.querySelector('#response-schemas')
    const picker = section?.nextElementSibling

    if (!picker || !picker.classList.contains('rm-APIResponseSchemaPicker')) {
        return []
    }

    return Array.from(picker.querySelectorAll('button')).map((option) => {
        const optionText = readText(option)
        const statusCodeMatch = optionText?.match(/\b\d{3}\b/)
        const markdownBlocks = Array.from(option.querySelectorAll('[data-testid="RDMD"]'))

        return {
            statusCode: statusCodeMatch?.[0] ?? null,
            description: readText(markdownBlocks[0] ?? null) ?? optionText,
        }
    }).filter((schema) => schema.statusCode !== null)
}

export const extractCodeSnippets = (root: QueryableNode): string[] => {
    return Array.from(root.querySelectorAll('.CodeSnippet'))
        .map((snippet) => extractCodeMirrorText(snippet))
        .filter((snippet): snippet is string => Boolean(snippet))
}

export const extractCodeMirrorText = (root: QueryableNode | null): string | null => {
    if (!root) {
        return null
    }

    const codeMirrorLines = Array.from(root.querySelectorAll('.CodeMirror-code pre.CodeMirror-line'))

    if (codeMirrorLines.length === 0) {
        return null
    }

    return codeMirrorLines
        .map((line) => line.textContent?.replace(/\u00a0/g, ' ') ?? '')
        .join('\n')
        .trimEnd() || null
}

export const extractRequestSnippetLabel = (root: QueryableNode): string | null => {
    const header = root.querySelector('header')

    if (!header) {
        return null
    }

    const buttonTexts = Array.from(header.querySelectorAll('button'))
        .map((button) => extractButtonText(button))
        .filter((text): text is string => Boolean(text))

    return buttonTexts.find((text) => text.toLowerCase() !== 'examples') ?? buttonTexts[0] ?? null
}

export const readInputValue = (element: AttributedNode | null): string | null => {
    if (!element) {
        return null
    }

    return element.getAttribute('value')?.trim() || null
}

export const extractSidebarLinkLabel = (link: QueryableNode, method: string | null): string => {
    const candidates = readTexts(link.querySelectorAll('span'))
        .filter((text) => !method || text.toUpperCase() !== method)
        .sort((left, right) => right.length - left.length)

    return candidates[0] ?? readText(link) ?? ''
}

export const extractResponseContentTypes = (root: QueryableNode): string[] => {
    const texts = readTexts(root.querySelectorAll('div'))

    return texts.filter((text) => /^[\w.+-]+\/[\w.+-]+$/i.test(text))
}

export const extractResponseLabels = (root: QueryableNode): string[] => {
    const statusElements = Array.from(root.querySelectorAll('button, [role="button"]'))
        .map((element) => extractButtonText(element))
        .filter((text): text is string => Boolean(text))

    return statusElements.filter((text) => /\b\d{3}\b/.test(text))
}

export const findParameterRoot = (
    label: HappyDomElement,
    root: QueryableNode
): HappyDomElement => {
    const fieldId = label.getAttribute('for')
    let current: HappyDomElement | null = label

    while (current) {
        const fieldInput = fieldId ? current.querySelector(`#${escapeSelector(fieldId)}`) : null
        const fallbackInput = current.querySelector('input, textarea, select')

        if ((fieldInput || fallbackInput) && current !== root) {
            return current
        }

        current = current.parentElement
    }

    return label
}

export const resolveParameterInput = (
    param: QueryableNode,
    label: AttributedNode
): AttributeQueryNode | null => {
    const fieldId = label.getAttribute('for')
    const byId = fieldId ? param.querySelector(`#${escapeSelector(fieldId)}`) : null
    const fallback = param.querySelector('input, textarea, select')

    return (byId ?? fallback) as AttributeQueryNode | null
}

export const inferParameterLocation = (
    param: HappyDomElement,
    label: AttributedNode,
    root: QueryableNode
): ReadmeParameter['in'] => {
    const fieldId = label.getAttribute('for')?.toLowerCase() ?? ''
    const parentFieldsetId = param.closest('[id]')?.getAttribute('id')?.toLowerCase() ?? ''
    const locationFromId = inferParameterLocationFromText(`${fieldId} ${parentFieldsetId}`)

    if (locationFromId) {
        return locationFromId
    }

    let current: HappyDomElement | null = param

    while (current && current !== root) {
        let sibling: HappyDomElement | null = current.previousElementSibling

        while (sibling) {
            if (sibling.tagName === 'HEADER') {
                const locationFromHeader = inferParameterLocationFromText(readText(sibling) ?? '')

                if (locationFromHeader) {
                    return locationFromHeader
                }
            }

            sibling = sibling.previousElementSibling
        }

        current = current.parentElement
    }

    return null
}

export const inferParameterLocationFromText = (value: string): ReadmeParameter['in'] => {
    const normalized = value.trim().toLowerCase()

    if (normalized.includes('query params') || normalized.includes('query-')) {
        return 'query'
    }

    if (normalized.includes('headers') || normalized.includes('header-')) {
        return 'header'
    }

    if (normalized.includes('body params') || normalized.includes('request body') || normalized.includes('body-')) {
        return 'body'
    }

    if (normalized.includes('path params') || normalized.includes('path-')) {
        return 'path'
    }

    if (normalized.includes('cookie') || normalized.includes('cookie-')) {
        return 'cookie'
    }

    return null
}

export const inferParameterPath = (
    label: AttributedNode,
    name: string | null
): string[] => {
    const fieldId = label.getAttribute('for') ?? ''
    const suffix = fieldId.includes('_') ? fieldId.slice(fieldId.indexOf('_') + 1) : ''

    if (suffix.includes('.')) {
        return suffix
            .split('.')
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0)
    }

    return name ? [name] : []
}

export const inferParameterType = (
    param: QueryableNode,
    input: AttributedNode | null
): string | null => {
    const inputType = input?.getAttribute('type')?.toLowerCase()

    if (inputType === 'text') {
        return 'string'
    }

    if (inputType) {
        return inputType
    }

    const field = Array.from(param.querySelectorAll('[class]')).find((element) => {
        const className = element.getAttribute('class') ?? ''

        return className.split(/\s+/).some((token) => token.startsWith('field-'))
    })

    const fieldClass = field?.getAttribute('class')?.split(/\s+/).find((token) => token.startsWith('field-'))

    if (fieldClass) {
        return fieldClass.replace(/^field-/, '')
    }

    return null
}

export const isRequiredParameter = (
    param: QueryableNode,
    input: AttributeQueryNode | null
): boolean => {
    if (input?.hasAttribute('required')) {
        return true
    }

    return readTexts(param.querySelectorAll('*')).some((text) => text.toLowerCase() === 'required')
}

export const extractParameterDescription = (param: QueryableNode): string | null => {
    const description = param.querySelector('[id$="__description"]')

    if (description) {
        return readText(description)
    }

    const markdownBlocks = Array.from(param.querySelectorAll('[data-testid="RDMD"]'))

    return readText(markdownBlocks[0] ?? null)
}

export const normalizeResponseBody = (
    body: string,
    contentType: string | null
): Pick<ReadmeResponseBody, 'format' | 'body'> => {
    const trimmed = body.trim()

    if (contentType?.toLowerCase().includes('json') || /^(?:\{|\[)/.test(trimmed)) {
        const parsedBody = JsonRepair.parsePossiblyTruncated(trimmed)

        if (parsedBody !== null) {
            return {
                format: 'json',
                body: parsedBody,
            }
        }

        const looseParsedBody = parseLooseStructuredValue(trimmed)

        if (looseParsedBody !== null) {
            return {
                format: 'json',
                body: looseParsedBody,
            }
        }

        return {
            format: 'text',
            body,
        }
    }

    return {
        format: 'text',
        body,
    }
}

export const normalizeRequestCodeSnippet = (
    snippet: ReadmeCodeSnippet | null
): ReadmeOperation['requestExampleNormalized'] => {
    if (!snippet) {
        return null
    }

    return normalizeCurlSnippet(snippet) ?? normalizeFetchSnippet(snippet) ?? {
        sourceLabel: snippet.label,
        method: null,
        url: null,
        headers: {},
        bodyFormat: null,
        body: null,
        rawBody: null,
    }
}

export const normalizeCurlSnippet = (
    snippet: ReadmeCodeSnippet
): ReadmeOperation['requestExampleNormalized'] => {
    if (!snippet.body.startsWith('curl ')) {
        return null
    }

    const method = snippet.body.match(/--request\s+([A-Z]+)/)?.[1] ?? null
    const url = snippet.body.match(/--url\s+(\S+)/)?.[1] ?? null
    const headers = Object.fromEntries(Array.from(snippet.body.matchAll(/--header\s+'([^:]+):\s*([^']+)'/g)).map((match) => [
        match[1].trim(),
        match[2].trim(),
    ]))
    const rawBodyMatch = snippet.body.match(/--data\s+'([\s\S]*)'$/)
    const rawBody = rawBodyMatch?.[1]?.trim() ?? null
    const normalizedBody = rawBody ? normalizeResponseBody(rawBody, headers['content-type'] ?? headers['Content-Type'] ?? null) : null

    return {
        sourceLabel: snippet.label,
        method,
        url,
        headers,
        bodyFormat: normalizedBody?.format ?? null,
        body: normalizedBody?.body ?? null,
        rawBody,
    }
}

export const normalizeFetchSnippet = (
    snippet: ReadmeCodeSnippet
): ReadmeOperation['requestExampleNormalized'] => {
    const fetchMatch = snippet.body.match(/fetch\(\s*(["'])(.*?)\1\s*,\s*\{([\s\S]*)\}\s*\)/)

    if (!fetchMatch) {
        return null
    }

    const [, , url, optionsBody] = fetchMatch
    const method = extractObjectPropertyValue(optionsBody, 'method')?.toUpperCase() ?? null
    const headers = extractFetchHeaders(optionsBody)
    const rawBody = extractFetchBody(optionsBody)
    const contentType = headers['content-type'] ?? headers['Content-Type'] ?? null
    const normalizedBody = rawBody ? normalizeStructuredRequestBody(rawBody, contentType) : null

    return {
        sourceLabel: snippet.label,
        method,
        url,
        headers,
        bodyFormat: normalizedBody?.format ?? null,
        body: normalizedBody?.body ?? null,
        rawBody,
    }
}

export const extractFetchHeaders = (optionsBody: string): Record<string, string> => {
    const headersBlock = extractObjectPropertyValue(optionsBody, 'headers')

    if (!headersBlock) {
        return {}
    }

    const parsedHeaders = parseLooseStructuredValue(headersBlock)

    if (!isRecord(parsedHeaders)) {
        return {}
    }

    return Object.fromEntries(Object.entries(parsedHeaders).map(([key, value]) => [
        key,
        String(value),
    ]))
}

export const extractFetchBody = (optionsBody: string): string | null => {
    return extractObjectPropertyValue(optionsBody, 'body')
}

export const normalizeStructuredRequestBody = (
    body: string,
    contentType: string | null
): Pick<ReadmeResponseBody, 'format' | 'body'> => {
    const parsedBody = parseLooseStructuredValue(body)

    if (parsedBody !== null && (contentType?.toLowerCase().includes('json') || /^[[{]/.test(body.trim()))) {
        return {
            format: 'json',
            body: parsedBody,
        }
    }

    return normalizeResponseBody(body, contentType)
}

export const extractObjectPropertyValue = (source: string, propertyName: string): string | null => {
    const propertyMatch = source.match(new RegExp(`\\b${propertyName}\\s*:`, 'm'))

    if (!propertyMatch || propertyMatch.index === undefined) {
        return null
    }

    let cursor = propertyMatch.index + propertyMatch[0].length

    while (/\s/.test(source[cursor] ?? '')) {
        cursor += 1
    }

    if (source.startsWith('JSON.stringify', cursor)) {
        const openParenIndex = source.indexOf('(', cursor)

        if (openParenIndex === -1) {
            return null
        }

        const wrappedArgument = extractBalancedSegment(source, openParenIndex, '(', ')')

        return wrappedArgument?.slice(1, -1).trim() ?? null
    }

    if (source[cursor] === '{' || source[cursor] === '[') {
        const closingChar = source[cursor] === '{' ? '}' : ']'

        return extractBalancedSegment(source, cursor, source[cursor], closingChar)?.trim() ?? null
    }

    if (source[cursor] === '"' || source[cursor] === '\'') {
        return extractStringLiteralValue(source, cursor)
    }

    const bareValue = source.slice(cursor).match(/^([^,\n]+)/)?.[1]

    return bareValue?.trim() ?? null
}

export const extractBalancedSegment = (
    source: string,
    startIndex: number,
    openChar: string,
    closeChar: string
): string | null => {
    let depth = 0
    let quoteChar: '"' | '\'' | null = null
    let isEscaped = false

    for (let index = startIndex; index < source.length; index += 1) {
        const character = source[index]

        if (quoteChar) {
            if (isEscaped) {
                isEscaped = false
                continue
            }

            if (character === '\\') {
                isEscaped = true
                continue
            }

            if (character === quoteChar) {
                quoteChar = null
            }

            continue
        }

        if (character === '"' || character === '\'') {
            quoteChar = character
            continue
        }

        if (character === openChar) {
            depth += 1
            continue
        }

        if (character === closeChar) {
            depth -= 1

            if (depth === 0) {
                return source.slice(startIndex, index + 1)
            }
        }
    }

    return null
}

export const extractStringLiteralValue = (source: string, startIndex: number): string | null => {
    const quoteChar = source[startIndex]
    let value = ''
    let isEscaped = false

    for (let index = startIndex + 1; index < source.length; index += 1) {
        const character = source[index]

        if (isEscaped) {
            value += character
            isEscaped = false
            continue
        }

        if (character === '\\') {
            isEscaped = true
            continue
        }

        if (character === quoteChar) {
            return value
        }

        value += character
    }

    return null
}

export const parseLooseStructuredValue = (value: string): unknown | null => {
    const trimmed = preprocessLooseStructuredValue(value).trim()

    if (!/^[[{]/.test(trimmed)) {
        return null
    }

    const normalized = replaceSingleQuotedStringsOutsideDoubleQuotes(trimmed
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*([}\]])/g, '$1'))

    try {
        return JSON.parse(normalized)
    } catch {
        return null
    }
}

const replaceSingleQuotedStringsOutsideDoubleQuotes = (value: string): string => {
    let result = ''
    let inDoubleString = false
    let inSingleString = false
    let isEscaped = false
    let singleQuotedContent = ''

    for (const character of value) {
        if (inSingleString) {
            if (isEscaped) {
                singleQuotedContent += character
                isEscaped = false
                continue
            }

            if (character === '\\') {
                isEscaped = true
                continue
            }

            if (character === '\'') {
                result += JSON.stringify(singleQuotedContent)
                singleQuotedContent = ''
                inSingleString = false
                continue
            }

            singleQuotedContent += character
            continue
        }

        if (inDoubleString) {
            result += character

            if (isEscaped) {
                isEscaped = false
                continue
            }

            if (character === '\\') {
                isEscaped = true
                continue
            }

            if (character === '"') {
                inDoubleString = false
            }

            continue
        }

        if (character === '\'') {
            inSingleString = true
            singleQuotedContent = ''
            continue
        }

        if (character === '"') {
            inDoubleString = true
        }

        result += character
    }

    return result
}

const preprocessLooseStructuredValue = (value: string): string => {
    let normalized = stripLineCommentsOutsideStrings(value)

    normalized = removeLooseBareTokensBeforeKeys(normalized)
    normalized = repairAnonymousDataEnvelope(normalized)

    return normalized
}

const stripLineCommentsOutsideStrings = (value: string): string => {
    let result = ''
    let inString = false
    let isEscaped = false

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]
        const nextCharacter = value[index + 1]

        if (inString) {
            result += character

            if (isEscaped) {
                isEscaped = false
                continue
            }

            if (character === '\\') {
                isEscaped = true
                continue
            }

            if (character === '"') {
                inString = false
            }

            continue
        }

        if (character === '"') {
            inString = true
            result += character
            continue
        }

        if (character === '/' && nextCharacter === '/') {
            while (index < value.length && value[index] !== '\n') {
                index += 1
            }

            if (index < value.length) {
                result += value[index]
            }

            continue
        }

        result += character
    }

    return result
}

const removeLooseBareTokensBeforeKeys = (value: string): string => {
    return value.replace(/([[{]\s*)([A-Za-z_$][\w$-]*)(\s+)(?=")/g, '$1')
}

const repairAnonymousDataEnvelope = (value: string): string => {
    const trimmed = value.trimStart()

    if (!trimmed.startsWith('{') || /"data"\s*:\s*\[/.test(trimmed)) {
        return value
    }

    if (!/^\{\s*"[^"]+"\s*:/.test(trimmed)) {
        return value
    }

    if (!/\]\s*,\s*"meta"\s*:/.test(trimmed)) {
        return value
    }

    const leadingWhitespace = value.slice(0, value.indexOf('{'))

    return `${leadingWhitespace}{"data": [{${trimmed.slice(1)}`
}

export const escapeSelector = (value: string): string => {
    return value.replace(/([#.:[\],=])/g, '\\$1')
}

export const readText = (element: TextNodeLike | null): string | null => {
    const value = element?.textContent?.replace(/\s+/g, ' ').trim()

    return value ? value : null
}

export const readTexts = (elements: Iterable<TextNodeLike>): string[] => {
    return Array.from(elements)
        .map((element) => readText(element))
        .filter((value): value is string => Boolean(value))
}

export const extractButtonText = (element: QueryableNode): string | null => {
    const texts = readTexts(element.querySelectorAll('span, div, code'))
        .filter((text) => text.trim().length > 0)

    return texts.sort((left, right) => right.length - left.length)[0] ?? readText(element)
}
