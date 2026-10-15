# SDK Kit Reference

`@oapiex/sdk-kit` provides the shared runtime primitives used by generated SDK packages.

Most users will install a generated SDK package instead of consuming the core kit directly. Reach for the kit when you want to:

- build a custom SDK around a generated manifest
- extend or customize generated API binders
- create your own class-based SDK on top of the shared runtime

## Install

::: code-group

```bash [pnpm]
pnpm add @oapiex/sdk-kit
```

```bash [npm]
npm i @oapiex/sdk-kit
```

```bash [yarn]
yarn add @oapiex/sdk-kit
```

:::

## Client Configuration

`Core` and `createSdk()` use the same `InitOptions` contract.

```ts
const sdk = new Core({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  environment: 'sandbox',
  urls: {
    sandbox: 'https://sandbox-api.example.com',
    live: 'https://api.example.com',
  },
  headers: {
    'X-Trace-Source': 'custom-sdk',
  },
  timeout: 15000,
  debugLevel: 1,
  encryptionKey: process.env.ENCRYPTION_KEY,
});
```

Supported init fields:

- `clientId` optional, useful when a validator or token exchange still needs client credentials
- `clientSecret` optional when `auth` is already configured
- `environment`
- `urls`
- `headers`
- `timeout`
- `encryptionKey`
- `auth`
- `debugLevel` optional HTTP debug verbosity, one of `0 | 1 | 2 | 3`

`urls` lets you override the base URL for `sandbox` and `live`, which is useful when an API has regional hosts, mock servers, or staging gateways.

If you already have an access token or API key, you can initialize without client credentials:

```ts
const sdk = new Core({
  environment: 'sandbox',
  auth: {
    type: 'bearer',
    token: process.env.ACCESS_TOKEN!,
  },
  debugLevel: 1,
});
```

`@oapiex/sdk-kit` can also read SDK init config from `oapiex.config.ts`, `oapiex.config.js`, or `oapiex.config.cjs` in the current working directory.

If your SDK should look for a different basename, switch it before the first client is created:

```ts
import { Core, setConfigFileBasename } from '@oapiex/sdk-kit';

setConfigFileBasename('maplerad.config');

const sdk = new Core();
```

You can pass either the basename stem such as `maplerad.config` or a concrete filename such as `maplerad.config.cjs`. The loader will normalize that value and look for `.ts`, `.js`, and `.cjs` variants under the selected basename.

For an SDK-focused config file, prefer `defineConfig()` from `@oapiex/sdk-kit`:

```ts
import { defineConfig } from '@oapiex/sdk-kit';

export default defineConfig({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  environment: 'sandbox',
  urls: {
    sandbox: 'https://sandbox-api.example.com',
  },
  headers: {
    'X-Trace-Source': 'custom-sdk',
  },
  timeout: 15000,
  auth: {
    type: 'bearer',
    token: process.env.ACCESS_TOKEN,
  },
  debugLevel: 1,
});
```

If you use the same `oapiex.config.*` file for extraction and SDK runtime defaults, prefer the root `oapiex` helper and scope the SDK settings under `sdkKit`:

```ts
import { defineConfig } from 'oapiex';

export default defineConfig({
  sdkKit: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    environment: 'sandbox',
    urls: {
      sandbox: 'https://sandbox-api.example.com',
    },
    headers: {
      'X-Trace-Source': 'custom-sdk',
    },
    timeout: 15000,
    auth: {
      type: 'bearer',
      token: process.env.ACCESS_TOKEN,
    },
    debugLevel: 1,
  },
});
```

Explicit constructor options override values loaded from the selected config basename.

## Debugging

SDK HTTP debugging is disabled by default.

- Use `sdk.debug(level)` after initialization when you want to turn debugging on or change verbosity dynamically.
- Use `debugLevel` in `InitOptions` when you want debug logging enabled immediately during construction.
- Supported levels are `0 | 1 | 2 | 3`.

```ts
const sdk = new Core({
  environment: 'sandbox',
  auth: {
    type: 'bearer',
    token: process.env.ACCESS_TOKEN!,
  },
  debugLevel: 2,
});

sdk.debug(3);
```

## Auth Strategies

The `auth` field accepts one auth strategy or an array of strategies.

### Bearer

```ts
auth: {
  type: 'bearer',
  token: process.env.ACCESS_TOKEN!,
}
```

### Basic

```ts
auth: {
  type: 'basic',
  username: process.env.API_USERNAME!,
  password: process.env.API_PASSWORD!,
}
```

### API Key

```ts
auth: {
  type: 'apiKey',
  name: 'X-API-Key',
  value: process.env.API_KEY!,
  in: 'header',
}
```

### OAuth2 Access Token

```ts
auth: {
  type: 'oauth2',
  accessToken: process.env.ACCESS_TOKEN!,
  tokenType: 'Bearer',
}
```

### Multiple Schemes

```ts
auth: [
  {
    type: 'apiKey',
    name: 'X-Partner-Key',
    value: process.env.PARTNER_KEY!,
    in: 'header',
  },
  {
    type: 'apiKey',
    name: 'api_key',
    value: process.env.QUERY_KEY!,
    in: 'query',
  },
];
```

### Custom Request Mutator

```ts
auth: {
  type: 'custom',
  apply: async (request) => ({
    ...request,
    headers: {
      ...request.headers,
      Authorization: `Token ${process.env.CUSTOM_TOKEN!}`,
    },
  }),
}
```

These strategies are applied centrally by `Http`, so generated class SDKs and manifest-driven SDKs both use the same auth behavior.

## Build An SDK From Scratch

You can use `@oapiex/sdk-kit` directly without `oapie generate sdk`.

The package gives you two workable patterns:

1. a class-based SDK built from custom API classes
2. a runtime manifest SDK built from a handwritten manifest bundle

The class-based approach is the better fit when you want a conventional SDK package with explicit methods, custom organization, and full control over types.

The runtime-manifest approach is the better fit when you want a lightweight adapter around a known route manifest.

### Class-Based SDK Structure

A minimal handwritten SDK usually looks like this:

```text
src/
  Contracts/
    Example.ts
  Apis/
    Example.ts
  BaseApi.ts
  ApiBinder.ts
  Core.ts
  index.ts
```

### 1. Define Your Contracts

Start with the request and response types your SDK methods will return.

```ts
export interface Example {
  id: string;
  code: string;
}

export interface ListExamplesQuery {
  code?: string;
}

export interface CreateExampleInput {
  code: string;
}
```

### 2. Create API Classes

Each API class should extend `BaseApi` so it can access `this.core`, `this.core.builder`, `this.core.http`, and `this.core.validateAccess()`. Send through `this.core.http` so requests use this client's own config (see [Several SDKs In One Process](#several-sdks-in-one-process)).

```ts
import { BaseApi } from '@oapiex/sdk-kit';

import type {
  CreateExampleInput,
  Example,
  ListExamplesQuery,
} from '../Contracts/Example';

export class ExampleApi extends BaseApi {
  async list(query: ListExamplesQuery = {}): Promise<Example[]> {
    await this.core.validateAccess();

    const { data } = await this.core.http.send<Example[]>(
      this.core.builder.buildTargetUrl('/v1/examples', {}, query),
      'GET',
      {},
      {},
    );

    return data;
  }

  async create(body: CreateExampleInput): Promise<Example> {
    await this.core.validateAccess();

    const { data } = await this.core.http.send<Example>(
      this.core.builder.buildTargetUrl('/v1/examples', {}, {}),
      'POST',
      body,
      {},
    );

    return data;
  }
}
```

### 3. Create An API Binder

The binder is the root API object exposed on `sdk.api`. Its job is to create and register your child API classes.

```ts
import { BaseApi } from '@oapiex/sdk-kit';

import { ExampleApi } from './Apis/Example';

export class ApiBinder extends BaseApi {
  examples!: ExampleApi;

  protected override boot() {
    this.examples = new ExampleApi(this.core);
  }
}
```

### 4. Create A Core Subclass

Your SDK-specific `Core` subclass points `apiClass` at the binder and narrows the `api` property type.

```ts
import { Core as KitCore } from '@oapiex/sdk-kit';

import { ApiBinder } from './ApiBinder';

export class Core extends KitCore {
  static override apiClass = ApiBinder;

  declare api: ApiBinder;
}
```

### 5. Export A Clean Package Entry

Your package entry should usually export the SDK root, binder, contracts, and any shared types you want consumers to use directly.

```ts
export * from './Contracts/Example';
export { ExampleApi } from './Apis/Example';
export { ApiBinder } from './ApiBinder';
export { Core } from './Core';

export type { InitOptions, UnifiedResponse } from '@oapiex/sdk-kit';
export { Builder, Http } from '@oapiex/sdk-kit';
```

### 6. Instantiate The SDK

```ts
import { Core } from 'your-sdk';

const sdk = new Core({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  environment: 'sandbox',
});

await sdk.api.examples.list({ code: 'NG' });
```

## Access Validation and Authentication

You can register an access validator if the SDK should enforce custom auth or readiness checks before requests are made.

```ts
sdk.setAccessValidator(async (core) => {
  return core.getEnvironment() ? true : 'SDK is not initialized correctly';
});
```

Validators can also replace auth or shared config before the request is sent.

This is useful when an API requires a token exchange step with the configured client credentials.

```ts
import axios from 'axios';

sdk.setAccessValidator(async (core) => {
  const response = await axios.post(
    'https://developersandbox-api.example.com/auth/token',
    {
      client_id: core.getClientId(),
      client_secret: core.getClientSecret(),
    },
  );

  return {
    auth: {
      type: 'bearer',
      token: response.data.access_token,
    },
    headers: {
      'X-Token-Source': 'access-validator',
    },
  };
});
```

Supported validator results:

- `true` or `undefined`: continue without changes
- `string`: stop and throw that message
- `AuthConfig` or `AuthConfig[]`: replace auth directly
- `Partial<UserConfig>`: update auth, headers, timeout, URLs, or encryption key together

You can also call `core.setAuth(...)`, `core.clearAuth()`, or `core.configure(...)` directly inside the validator when you want imperative control.

### Cached Token Refresh

For APIs that return expiring bearer tokens, `createAccessTokenCache()` avoids hitting the auth endpoint on every request.

```ts
import axios from 'axios';
import { createAccessTokenCache } from '@oapiex/sdk-kit';

const tokenCache = createAccessTokenCache(async (core) => {
  const response = await axios.post(
    'https://developersandbox-api.example.com/auth/token',
    {
      client_id: core.getClientId(),
      client_secret: core.getClientSecret(),
    },
  );

  return {
    token: response.data.access_token,
    expiresInSeconds: Math.max((response.data.expires_in ?? 60) - 30, 1),
  };
});

sdk.setAccessValidator(tokenCache);
```

`createAccessTokenCache()` returns an access validator that caches the auth result until expiry, then refreshes it automatically on the next guarded request.

Generated SDKs rely on the same mechanism.

## Runtime Manifest SDK From Scratch

If you do not want handwritten API classes, you can hand-author a runtime manifest bundle and bind it with `createSdk()`.

```ts
import { createSdk, type RuntimeSdkBundle } from '@oapiex/sdk-kit';

const bundle = {
  document: {},
  manifest: {
    groups: [
      {
        className: 'Example',
        propertyName: 'examples',
        operations: [
          {
            path: '/v1/examples',
            method: 'GET',
            methodName: 'list',
            responseType: 'Example[]',
            inputType: 'Record<string, never>',
            queryType: 'ListExamplesQuery',
            headerType: 'Record<string, never>',
            paramsType: 'Record<string, never>',
            hasBody: false,
            bodyRequired: false,
            pathParams: [],
            queryParams: [
              {
                name: 'code',
                accessor: 'code',
                in: 'query',
                required: false,
              },
            ],
            headerParams: [],
          },
        ],
      },
    ],
  },
} satisfies RuntimeSdkBundle;

const sdk = createSdk(bundle, {
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  environment: 'sandbox',
  auth: {
    type: 'bearer',
    token: process.env.ACCESS_TOKEN!,
  },
});

await sdk.api.examples.list({ code: 'NG' });
```

This avoids writing API classes, but you lose the clarity and explicitness of handwritten method implementations.

## When To Use The Generator Anyway

Building from scratch is useful when:

- the API surface is small
- you want a highly curated SDK
- you already have your own domain contracts and naming
- you want to wrap a non-OpenAPI source manually

The generator is still the better choice when:

- the API is large
- you want complete route coverage quickly
- you want generated schema types, runtime manifests, JSDoc, README output, and tests out of the box
- you want class and runtime SDK entrypoints emitted consistently from one source document

## Main Exports

### `Core`

The base authenticated SDK client.

`Core` handles:

- environment selection
- its own config (`getConfig()`), separate from other clients
- a URL builder bound to that config (`core.builder`)
- an HTTP client bound to that config (`core.http`)
- access validation
- API bootstrapping
- runtime manifest binding through `useDocument()` and `useSdk()`

### `BaseApi`

The base API class used for SDK-specific binders and generated API classes.

Generated SDKs build on top of this by:

1. creating a package-local `BaseApi` subclass
2. creating an `ApiBinder` that wires child API groups in `boot()`
3. making generated API classes extend the package-local `BaseApi`

### `createSdk()`

Helper for creating a runtime SDK from a generated manifest bundle.

```ts
import { createSdk } from '@oapiex/sdk-kit';
import { extractedApiDocumentSdk } from './Schema';

const sdk = createSdk(extractedApiDocumentSdk, {
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  environment: 'sandbox',
});
```

### `createRuntimeApi()`

Lower-level helper that binds manifest operations onto a `BaseApi` instance.

Generated packages usually hide this behind `createClient()` or `Core.useDocument()`.

### `Http`

HTTP transport. `core.http` (created with `Http.scoped()`) sends with one client's config and is what generated classes and runtime manifest calls use. The static `Http.send` / `Http.get` send with the process-wide config.

### `Builder`

Resolves target URLs and environment-specific base URLs. `core.builder` is an instance bound to one client's config; the static methods use the process-wide config.

## Several SDKs In One Process

Each `Core` keeps its own config: base URLs, environment, auth, headers, timeout and debug level. `core.builder` and `core.http` read only that config, so two SDKs built on the kit (or two clients of one SDK with different credentials) can run side by side without overwriting each other:

```ts
const payments = new PaymentsCore({
  environment: 'live',
  auth: { type: 'bearer', token: process.env.PAYMENTS_SECRET! },
});
const banking = new BankingCore({
  environment: 'sandbox',
  auth: { type: 'apiKey', in: 'header', name: 'x-api-key', value: process.env.BANKING_KEY! },
});

// Each request goes to its own base URL with its own credentials.
await payments.api.transfers.list();
await banking.api.accounts.list();
```

Changing one client (`setAuth()`, `configure()`, `builder.setEnvironment()`) does not affect another.

For backward compatibility, creating or configuring a `Core` still updates the process-wide config, so code that calls the static `Http.send` with `Builder.buildTargetUrl` keeps working; that path is shared, so it is the one to avoid when more than one client is active. API classes generated by OAPIEX use `this.core.http`.

## Contracts And Types

The package also exports shared contracts and helper types, including:

- `AuthConfig`
- `createAccessTokenCache`
- `InitOptions`
- `UnifiedResponse`
- `RuntimeSdkBundle`
- `RuntimeSdkManifest`
- `InferRuntimeSdkApi`

## Class-Based Example

```ts
import { BaseApi, Core } from '@oapiex/sdk-kit';

class ExampleApi extends BaseApi {
  async list() {
    await this.core.validateAccess();

    const { data } = await this.core.http.send(
      this.core.builder.buildTargetUrl('/v1/examples', {}, {}),
      'GET',
      {},
      {},
    );

    return data;
  }
}

class ApiBinder extends BaseApi {
  examples!: ExampleApi;

  protected override boot() {
    this.examples = new ExampleApi(this.core);
  }
}

class ExampleCore extends Core {
  static override apiClass = ApiBinder;

  declare api: ApiBinder;
}
```

## Runtime Manifest Example

```ts
import { createSdk } from '@oapiex/sdk-kit';
import { extractedApiDocumentSdk } from './Schema';

const sdk = createSdk(extractedApiDocumentSdk, {
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  environment: 'sandbox',
});

await sdk.api.examples.list({ code: 'NG' });
```

## Related Docs

- [SDK Generation](/guide/sdk-generation)
- [Programmatic Usage](/reference/programmatic-usage)
- [CLI Reference](/reference/cli)
