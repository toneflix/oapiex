import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from '../src/index'

describe('example-runtime-sdk runtime client', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('binds manifest groups and calls through the shared runtime sdk', async () => {
        const sdk = createClient({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            environment: 'sandbox',
        })
        const validator = vi.fn(async () => true)
        const sendSpy = vi.spyOn(sdk.http, 'send')

        sdk.setAccessValidator(validator)

        sendSpy.mockResolvedValueOnce({
            success: true,
            message: 'ok',
            data: [],
            meta: {},
        })

        await expect(
            sdk.api.examples.list({ code: 'NG' }, { 'X-Key-1': 'header-1' })
        ).resolves.toEqual([])

        sendSpy.mockResolvedValueOnce({
            success: true,
            message: 'ok',
            data: {
                id: 'profile-1',
                displayName: 'Jane Doe',
                email: 'jane@example.com',
                status: 'active',
            },
            meta: {},
        })

        await expect(
            sdk.api.profiles.get({ profileId: 'profile-1' })
        ).resolves.toEqual({
            id: 'profile-1',
            displayName: 'Jane Doe',
            email: 'jane@example.com',
            status: 'active',
        })

        expect(validator).toHaveBeenCalledTimes(2)
        expect(validator).toHaveBeenCalledWith(sdk)
        expect(sendSpy).toHaveBeenCalledTimes(2)
    })
})
