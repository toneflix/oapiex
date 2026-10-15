import { afterEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'

import { BaseApi } from '../src/Apis/BaseApi'
import { Builder } from '../src/Builder'
import { Core } from '../src/Core'
import { Http } from '../src/Http'
import { getConfig, resetConfig } from '../src/utilities/Manager'

type Captured = {
    baseURL?: string
    headers: Record<string, string>
    timeout?: number
    url: string
}

/**
 * Capture every request axios would send, answering with `response` (or
 * rejecting with `status` when given).
 */
const captureRequests = (response: unknown = { data: { ok: true } }, status?: number) => {
    const captured: Captured[] = []

    vi.spyOn(axios, 'create').mockImplementation(((defaults: Record<string, any>) => {
        const request = vi.fn(async (config: Record<string, any>) => {
            captured.push({
                baseURL: defaults.baseURL,
                headers: { ...(defaults.headers ?? {}) },
                timeout: defaults.timeout,
                url: config.url,
            })

            if (status) {
                throw Object.assign(new Error('Request failed'), { response: { status, data: {} } })
            }

            return { data: response }
        })

        return Object.assign(request, {
            interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
            defaults: {},
        })
    }) as never)

    return captured
}

const header = (headers: Record<string, string>, name: string) =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

const anchorLike = () => new Core({
    environment: 'sandbox',
    urls: { sandbox: 'https://api.sandbox.anchor.test', live: 'https://api.anchor.test' },
    auth: { type: 'apiKey', in: 'header', name: 'x-anchor-key', value: 'anchor-key' },
    headers: { 'x-sdk': 'anchor' },
    timeout: 1000,
})

const mapleradLike = () => new Core({
    environment: 'live',
    urls: { sandbox: 'https://sandbox.maplerad.test', live: 'https://api.maplerad.test' },
    auth: { type: 'bearer', token: 'maplerad-secret' },
    headers: { 'x-sdk': 'maplerad' },
    timeout: 2000,
})

describe('multiple clients in one process', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        resetConfig()
        Http.clearAuth()
        Builder.setEnvironment('sandbox')
    })

    it('sends each client\'s requests with its own base url, environment and auth', async () => {
        const captured = captureRequests()
        const anchor = anchorLike()
        // Created second: before the fix it overwrote the first client's config.
        const maplerad = mapleradLike()

        await anchor.http.send(anchor.builder.buildTargetUrl('/api/v1/banks'), 'GET')
        await maplerad.http.send(maplerad.builder.buildTargetUrl('/v1/wallets'), 'GET')

        const [anchorRequest, mapleradRequest] = captured

        expect(anchorRequest.url).toBe('https://api.sandbox.anchor.test/api/v1/banks')
        expect(anchorRequest.baseURL).toBe('https://api.sandbox.anchor.test/')
        expect(header(anchorRequest.headers, 'x-anchor-key')).toBe('anchor-key')
        expect(header(anchorRequest.headers, 'Authorization')).toBeUndefined()
        expect(header(anchorRequest.headers, 'x-sdk')).toBe('anchor')
        expect(anchorRequest.timeout).toBe(1000)

        expect(mapleradRequest.url).toBe('https://api.maplerad.test/v1/wallets')
        expect(mapleradRequest.baseURL).toBe('https://api.maplerad.test/')
        expect(header(mapleradRequest.headers, 'Authorization')).toBe('Bearer maplerad-secret')
        expect(header(mapleradRequest.headers, 'x-anchor-key')).toBeUndefined()
        expect(header(mapleradRequest.headers, 'x-sdk')).toBe('maplerad')
        expect(mapleradRequest.timeout).toBe(2000)
    })

    it('keeps each client\'s config separate when one is reconfigured', () => {
        const anchor = anchorLike()
        const maplerad = mapleradLike()

        maplerad.setAuth({ type: 'bearer', token: 'rotated' })
        maplerad.configure({ environment: 'sandbox' })

        expect(anchor.getConfig().auth).toEqual({ type: 'apiKey', in: 'header', name: 'x-anchor-key', value: 'anchor-key' })
        expect(anchor.getEnvironment()).toBe('sandbox')
        expect(anchor.builder.baseUrl()).toBe('https://api.sandbox.anchor.test/')
        expect(maplerad.getConfig().auth).toEqual({ type: 'bearer', token: 'rotated' })
        expect(maplerad.builder.baseUrl()).toBe('https://sandbox.maplerad.test/')
    })

    it('lets a client switch environment on its own builder without moving others', () => {
        const anchor = anchorLike()
        const maplerad = mapleradLike()

        anchor.builder.setEnvironment('live')

        expect(anchor.builder.buildTargetUrl('/x')).toBe('https://api.anchor.test/x')
        expect(maplerad.builder.buildTargetUrl('/x')).toBe('https://api.maplerad.test/x')
    })

    it('records an exception on the api of the client that made the request', async () => {
        captureRequests({}, 400)
        const anchor = anchorLike()
        const maplerad = mapleradLike()

        await expect(anchor.http.send(anchor.builder.buildTargetUrl('/fail'), 'GET')).rejects.toBeInstanceOf(Error)

        expect(anchor.api.getLastException()).toBeDefined()
        expect(maplerad.api.getLastException()).toBeUndefined()
        expect(anchor.api).toBeInstanceOf(BaseApi)
    })

    it('still drives the static Http.send from the process-wide config, as before', async () => {
        const captured = captureRequests()
        anchorLike()
        mapleradLike()

        // The last client configured still sets the process-wide defaults.
        expect(getConfig().auth).toEqual({ type: 'bearer', token: 'maplerad-secret' })

        await Http.send(Builder.buildTargetUrl('/legacy'), 'GET')

        expect(captured[0].url).toBe('https://api.maplerad.test/legacy')
        expect(header(captured[0].headers, 'Authorization')).toBe('Bearer maplerad-secret')
    })
})
