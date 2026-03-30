/**
 * mailcraft-satori SDK — Main client
 */

import type {
  SatoriClientConfig,
  SatoriAPIError,
  CardOpts,
  FormatPreset,
  CollectionFormat,
  RenderCollectionResponse,
  CreateJobRequest,
  Job,
  CreateTemplateRequest,
  Template,
  RenderTemplateRequest,
  ComplianceResult,
  VariantInfo,
  PresetInfo,
} from './types'

const DEFAULT_BASE_URL = 'https://mailcraft-satori.vguruprasad91.workers.dev'

// ── Error class ───────────────────────────────────────────────────────────────

export class SatoriError extends Error {
  readonly status: number
  readonly body: SatoriAPIError

  constructor(body: SatoriAPIError) {
    super(body.error)
    this.name = 'SatoriError'
    this.status = body.status
    this.body = body
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Client ────────────────────────────────────────────────────────────────────

export class SatoriClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly retries: number

  constructor(config: SatoriClientConfig) {
    this.apiKey  = config.apiKey
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeout = config.timeout ?? 30_000
    this.retries = config.retries ?? 2
  }

  // ── Low-level fetch ────────────────────────────────────────────────────────

  private async _fetch(
    path:    string,
    options: RequestInit = {},
    attempt  = 0,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'X-API-Key':    this.apiKey,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      })
      clearTimeout(timer)
      return res
    } catch (err: unknown) {
      clearTimeout(timer)
      // Retry on network errors
      if (attempt < this.retries) {
        await sleep(200 * 2 ** attempt)
        return this._fetch(path, options, attempt + 1)
      }
      throw err
    }
  }

  private async _json<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await this._fetch(path, options)
    const body = await res.json() as T | SatoriAPIError
    if (!res.ok) {
      throw new SatoriError({ ...(body as SatoriAPIError), status: res.status })
    }
    return body as T
  }

  private async _binary(path: string, options?: RequestInit): Promise<Uint8Array> {
    const res = await this._fetch(path, options)
    if (!res.ok) {
      const body = await res.json() as SatoriAPIError
      throw new SatoriError({ ...body, status: res.status })
    }
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  /**
   * Render a single card and return raw PNG/WebP bytes.
   *
   * @example
   * const png = await client.render({
   *   variant: 'stat-hero',
   *   headline: '10x Growth',
   *   brandName: 'Acme',
   *   primaryColor: '#6C63FF',
   *   preset: 'instagram-square',
   * })
   * fs.writeFileSync('output.png', png)
   */
  async render(opts: CardOpts): Promise<Uint8Array> {
    return this._binary('/render', {
      method:  'POST',
      body:    JSON.stringify(opts),
    })
  }

  /**
   * Render a card and return a base64 data URI string.
   * Convenient for embedding directly in HTML/email.
   *
   * @example
   * const dataUri = await client.renderDataUri({ ... })
   * // "data:image/png;base64,iVBOR..."
   */
  async renderDataUri(opts: CardOpts): Promise<string> {
    const bytes = await this.render(opts)
    const b64   = bufferToBase64(bytes)
    const mime  = opts.format === 'webp' ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${b64}`
  }

  /**
   * Render a carousel of slides (multiple CardOpts in one call).
   * Returns an array of base64 data URIs.
   *
   * @example
   * const slides = await client.renderCarousel([
   *   { headline: 'Slide 1', brandName: 'Acme', primaryColor: '#6C63FF' },
   *   { headline: 'Slide 2', brandName: 'Acme', primaryColor: '#6C63FF' },
   * ])
   */
  async renderCarousel(slides: CardOpts[], format?: FormatPreset): Promise<string[]> {
    const res = await this._json<{ slides: Array<{ image: string }> }>('/render-carousel', {
      method: 'POST',
      body:   JSON.stringify({ slides, format }),
    })
    return res.slides.map(s => s.image)
  }

  // ── Collection ─────────────────────────────────────────────────────────────

  /**
   * Render a brand kit across multiple format presets in one request.
   * Returns all sizes as base64 data URIs.
   *
   * @example
   * const result = await client.renderCollection({
   *   brandKit: { headline: 'Summer Sale', brandName: 'Shop', primaryColor: '#FF6B6B' },
   *   formats: [
   *     { preset: 'instagram-square' },
   *     { preset: 'facebook-linkedin' },
   *     { preset: 'twitter-x' },
   *     { preset: 'instagram-story' },
   *   ],
   * })
   */
  async renderCollection(request: {
    brandKit: CardOpts
    formats:  CollectionFormat[]
  }): Promise<RenderCollectionResponse> {
    const res = await this._json<RenderCollectionResponse>('/render-collection', {
      method: 'POST',
      body:   JSON.stringify(request),
    })
    // Normalise: expose `slides` as alias for `outputs` for ergonomic access
    if (res.outputs && !res.slides) res.slides = res.outputs
    return res
  }

  // ── Async Jobs ─────────────────────────────────────────────────────────────

  /**
   * Create an async render job (useful for large renders or webhooks).
   * Returns a jobId — poll with getJob() or receive webhook callback.
   *
   * @example
   * const job = await client.createJob({
   *   headline: 'Product Launch',
   *   brandName: 'Acme',
   *   primaryColor: '#6C63FF',
   *   webhookUrl: 'https://yoursite.com/hooks/satori',
   * })
   * console.log(job.jobId)
   */
  async createJob(opts: CreateJobRequest): Promise<Job> {
    return this._json<Job>('/jobs', {
      method: 'POST',
      body:   JSON.stringify(opts),
    })
  }

  /**
   * Poll an async job for status and result URL.
   */
  async getJob(jobId: string): Promise<Job> {
    return this._json<Job>(`/jobs/${jobId}`)
  }

  /**
   * Wait for an async job to complete (polls with exponential backoff).
   *
   * @param jobId     Job ID from createJob()
   * @param maxWaitMs Maximum total wait time in ms (default: 30s)
   */
  async waitForJob(jobId: string, maxWaitMs = 30_000): Promise<Job> {
    const start   = Date.now()
    let   delay   = 500

    while (Date.now() - start < maxWaitMs) {
      const job = await this.getJob(jobId)
      if (job.status === 'done' || job.status === 'failed') return job
      await sleep(delay)
      delay = Math.min(delay * 1.5, 5_000)
    }

    throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`)
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  /**
   * Create a custom template with {{token}} placeholders.
   *
   * @example
   * const tpl = await client.createTemplate({
   *   id: 'my-welcome-card',
   *   name: 'Welcome Card',
   *   width: 1200,
   *   height: 628,
   *   tokens: {
   *     name:  { type: 'text',  description: 'Recipient name' },
   *     color: { type: 'color', description: 'Brand color', default: '#6C63FF' },
   *   },
   *   tree: { type: 'div', props: { style: { background: '{{color}}' }, children: '{{name}}' } },
   * })
   */
  async createTemplate(tpl: CreateTemplateRequest): Promise<Template> {
    return this._json<Template>('/templates', {
      method: 'POST',
      body:   JSON.stringify(tpl),
    })
  }

  /**
   * List all custom templates for your API key.
   */
  async listTemplates(): Promise<Template[]> {
    return this._json<Template[]>('/templates')
  }

  /**
   * Get a specific custom template by ID.
   */
  async getTemplate(id: string): Promise<Template> {
    return this._json<Template>(`/templates/${id}`)
  }

  /**
   * Delete a custom template.
   */
  async deleteTemplate(id: string): Promise<{ deleted: boolean }> {
    return this._json<{ deleted: boolean }>(`/templates/${id}`, { method: 'DELETE' })
  }

  /**
   * Render a custom template by injecting values for all {{tokens}}.
   * Returns raw PNG/WebP bytes.
   *
   * @example
   * const png = await client.renderTemplate('my-welcome-card', {
   *   values: { name: 'Alice', color: '#FF6B6B' },
   * })
   */
  async renderTemplate(id: string, request: RenderTemplateRequest): Promise<Uint8Array> {
    return this._binary(`/render/${id}`, {
      method: 'POST',
      body:   JSON.stringify(request),
    })
  }

  // ── Compliance ─────────────────────────────────────────────────────────────

  /**
   * Check image dimensions against platform ad specs.
   *
   * @example
   * const result = await client.checkCompliance(1200, 628, 'meta')
   * console.log(result.pass, result.recommendations)
   */
  async checkCompliance(
    width:    number,
    height:   number,
    platform: string,
  ): Promise<ComplianceResult> {
    return this._json<ComplianceResult>('/compliance', {
      method: 'POST',
      body:   JSON.stringify({ width, height, platform }),
    })
  }

  /**
   * Detect which platforms support a given image size.
   *
   * @example
   * const platforms = await client.detectPlatforms(1200, 628)
   * // ['meta/instagram', 'google-display', 'linkedin', 'twitter/x']
   */
  async detectPlatforms(width: number, height: number): Promise<string[]> {
    const res = await this._json<{ platforms: string[] }>('/compliance/detect', {
      method: 'POST',
      body:   JSON.stringify({ width, height }),
    })
    return res.platforms
  }

  // ── Variants & Presets metadata ────────────────────────────────────────────

  /**
   * List all available variant names and metadata.
   * Returns a flat array with each variant's name injected as a `name` field.
   */
  async listVariants(): Promise<VariantInfo[]> {
    const res = await this._json<{ variants: Record<string, Omit<VariantInfo, 'name'>>; count: number }>('/variants')
    const map = res.variants
    // API returns a map { "stat-hero": { description, vertical, fields }, ... }
    if (Array.isArray(map)) return map as unknown as VariantInfo[]
    return Object.entries(map).map(([name, info]) => ({
      name: name as VariantInfo['name'],
      label: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: (info as Record<string, string>).vertical ?? 'general',
      description: (info as Record<string, string>).description,
    }))
  }

  /**
   * List all format presets with dimensions.
   */
  async listPresets(): Promise<PresetInfo[]> {
    const res = await this._json<{ presets: Record<string, { w: number; h: number; label?: string }> | PresetInfo[]; count: number }>('/presets')
    const map = res.presets
    // API may return a map or an array
    if (Array.isArray(map)) return map as PresetInfo[]
    return Object.entries(map).map(([name, info]) => ({
      name: name as PresetInfo['name'],
      width: (info as { w: number; h: number }).w,
      height: (info as { w: number; h: number }).h,
      label: (info as { label?: string }).label ?? name,
    }))
  }

  // ── OpenAPI spec ───────────────────────────────────────────────────────────

  /**
   * Fetch the OpenAPI 3.0 specification for this API.
   */
  async getOpenApiSpec(): Promise<Record<string, unknown>> {
    return this._json<Record<string, unknown>>('/openapi.json')
  }
}

// ── Utility: base64 encoding (works in Node ≥18 + browser) ───────────────────

function bufferToBase64(bytes: Uint8Array): string {
  // Browser
  if (typeof btoa !== 'undefined') {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }
  // Node.js 18+
  return Buffer.from(bytes).toString('base64')
}
