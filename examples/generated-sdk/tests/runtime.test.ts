import { Core, createClient } from '../src/index'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BusinessIssuing } from '../src/Apis/BusinessIssuing'
import { CustomerTransaction } from '../src/Apis/CustomerTransaction'
import { Http } from '@oapiex/sdk-kit'

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

        expect(core.api.businessIssuings).toBeInstanceOf(BusinessIssuing)
        expect(core.api.customerTransactions).toBeInstanceOf(CustomerTransaction)

        await expect(core.api.businessIssuings.create({
            auto_approve: true,
            brand: 'visa',
            currency: 'USD',
            name: 'John Doe',
            type: 'personal'
        })).resolves.toEqual([])

        sendSpy.mockResolvedValueOnce({
            success: true,
            message: 'ok',
            data: {
                currency: 'USD',
                cvv: '123',
                expiry: '12/34',
                id: 'card-1'
            },
            meta: {},
        })

        await expect(core.api.businessIssuings.create({
            auto_approve: true,
            brand: 'visa',
            currency: 'USD',
            name: 'John Doe',
            type: 'personal'
        })).resolves.toEqual({
            currency: 'USD',
            cvv: '123',
            expiry: '12/34',
            id: 'card-1'
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
            },
            meta: {},
        })

        await expect(
            sdk.api.addonCables.get({ addon_id: 'addon-1', biller: 'biller-1' })
        ).resolves.toEqual({
            id: 'profile-1',
            displayName: 'Jane Doe',
        })

        expect(validator).toHaveBeenCalledTimes(1)
        expect(validator).toHaveBeenCalledWith(sdk)
        expect(sendSpy).toHaveBeenCalledTimes(1)
    })
})