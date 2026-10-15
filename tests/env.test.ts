import { describe, it, expect } from 'vitest'
import { validateEnv } from '../src/config/env.js'

describe('Environment Variables Validation', () => {
  it('should validate valid MS_GRAPH + GEMINI configuration', () => {
    const validConfig = {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'MS_GRAPH',
      AZURE_TENANT_ID: 'tenant-123',
      AZURE_CLIENT_ID: 'client-123',
      AZURE_CLIENT_SECRET: 'secret-123',
      MS_GRAPH_MAILBOX_USER: 'suporte@empresa.com',
      AI_PROVIDER: 'GEMINI',
      GEMINI_API_KEY: 'test-api-key',
      GITHUB_AUTH_TOKEN: 'ghp_testtoken',
      ALERT_NOTIFICATION_EMAIL: 'alerta@empresa.com',
    }

    const env = validateEnv(validConfig as any)
    expect(env.EMAIL_PROVIDER).toBe('MS_GRAPH')
    expect(env.AI_PROVIDER).toBe('GEMINI')
    expect(env.POLLING_INTERVAL_SECONDS).toBe(60) // default value
  })

  it('should fail when GEMINI_API_KEY is missing while AI_PROVIDER=GEMINI', () => {
    const invalidConfig = {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'MS_GRAPH',
      AZURE_TENANT_ID: 'tenant-123',
      AZURE_CLIENT_ID: 'client-123',
      AZURE_CLIENT_SECRET: 'secret-123',
      MS_GRAPH_MAILBOX_USER: 'suporte@empresa.com',
      AI_PROVIDER: 'GEMINI',
      GITHUB_AUTH_TOKEN: 'ghp_testtoken',
      ALERT_NOTIFICATION_EMAIL: 'alerta@empresa.com',
    }

    expect(() => validateEnv(invalidConfig as any)).toThrow()
  })

  it('should fail when Azure credentials are missing while EMAIL_PROVIDER=MS_GRAPH', () => {
    const invalidConfig = {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'MS_GRAPH',
      AI_PROVIDER: 'GEMINI',
      GEMINI_API_KEY: 'test-api-key',
      GITHUB_AUTH_TOKEN: 'ghp_testtoken',
      ALERT_NOTIFICATION_EMAIL: 'alerta@empresa.com',
    }

    expect(() => validateEnv(invalidConfig as any)).toThrow()
  })
})
