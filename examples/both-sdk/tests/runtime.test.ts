import { Core, createClient } from '../src/index'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Example } from '../src/Apis/Example'
import { Http } from '@oapiex/sdk-kit'
import { Profile } from '../src/Apis/Profile'

describe('example-both-sdk runtime client', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('wires multiple generated api groups onto the sdk base api', async () => {
        const core = new Core({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            environment: 'sandbox',
        })
        const validator = vi.fn(async () => true)
        const sendSpy = vi.spyOn(Http, 'send')

        sendSpy.mockResolvedValueOnce({
            success: true,
            message: 'ok',
            data: [],
            meta: {},
        })

        core.setAccessValidator(validator)

        expect(core.api.examples).toBeInstanceOf(Example)
        expect(core.api.profiles).toBeInstanceOf(Profile)

        await expect(core.api.examples.list({ code: 'NG' })).resolves.toEqual([])

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

        await expect(core.api.profiles.get({ profileId: 'profile-1' })).resolves.toEqual({
            id: 'profile-1',
            displayName: 'Jane Doe',
            email: 'jane@example.com',
            status: 'active',
        })

        expect(validator).toHaveBeenCalledTimes(2)
        expect(validator).toHaveBeenCalledWith(core)
        expect(sendSpy).toHaveBeenCalledTimes(2)
    })

    it('still supports the manifest-driven runtime helper from the package entry', async () => {
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
            data: {
                id: 'profile-1',
                displayName: 'Jane Doe',
                email: 'jane@example.com',
                status: 'disabled',
            },
            meta: {},
        })

        await expect(
            sdk.api.profiles.update({ profileId: 'profile-1' }, { status: 'disabled' })
        ).resolves.toEqual({
            id: 'profile-1',
            displayName: 'Jane Doe',
            email: 'jane@example.com',
            status: 'disabled',
        })

        expect(validator).toHaveBeenCalledTimes(1)
        expect(validator).toHaveBeenCalledWith(sdk)
        expect(sendSpy).toHaveBeenCalledTimes(1)
    })
})