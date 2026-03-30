/**
 * mailcraft-satori — Node.js / Browser SDK
 *
 * @example
 * import { SatoriClient } from 'mailcraft-satori'
 *
 * const client = new SatoriClient({ apiKey: 'your-api-key' })
 *
 * const png = await client.render({
 *   variant: 'stat-hero',
 *   headline: '10× Revenue Growth',
 *   brandName: 'Acme Corp',
 *   primaryColor: '#6C63FF',
 *   preset: 'instagram-square',
 * })
 */

export { SatoriClient, SatoriError } from './client'
export type {
  SatoriClientConfig,
  SatoriAPIError,
  CardOpts,
  CardVariantName,
  FormatPreset,
  AestheticRegister,
  CollectionFormat,
  RenderCollectionResponse,
  CollectionSlide,
  CreateJobRequest,
  Job,
  CreateTemplateRequest,
  Template,
  TemplateToken,
  RenderTemplateRequest,
  ComplianceResult,
  ComplianceCheck,
  VariantInfo,
  PresetInfo,
} from './types'
