# Configuration

## Config File Resolution

OAPIEX looks for configuration files in the current working directory using these names:

- `oapiex.config.ts`
- `oapiex.config.js`
- `oapiex.config.cjs`

## Example

```js
import { defineConfig } from 'oapiex';

export default defineConfig({
  outputFormat: 'json',
  outputShape: 'openapi',
  browser: 'puppeteer',
  requestTimeout: 50000,
  maxRedirects: 5,
  userAgent:
    'Mozilla/5.0 (X11; Linux x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenApiExtractor/1.0.0',
  retryCount: 3,
  retryDelay: 1000,
  crawlConcurrency: 4,
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  happyDom: {
    enableJavaScriptEvaluation: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
  },
});
```

## Supported Fields

- `outputFormat`: `pretty`, `json`, `js`
- `outputShape`: `raw`, `openapi`
- `browser`: `axios`, `happy-dom`, `jsdom`, `puppeteer`
- `requestTimeout`: request and page timeout in milliseconds
- `maxRedirects`: maximum redirect count for HTTP loading
- `userAgent`: user agent string used for remote requests
- `retryCount`: retry count setting reserved for loaders that implement retries
- `retryDelay`: retry delay in milliseconds
- `crawlConcurrency`: maximum number of documentation pages loaded at once (defaults to `4`)
- `happyDom`: Happy DOM browser options
- `puppeteer`: Puppeteer launch options

## Merge Behavior

Default settings are merged with the user config, and CLI overrides are applied last.
