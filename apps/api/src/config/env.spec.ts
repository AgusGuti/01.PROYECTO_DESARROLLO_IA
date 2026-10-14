import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';

const valid = { MONGODB_URI: 'mongodb://127.0.0.1:27017/print3d' };

describe('loadConfig', () => {
  it('applies safe defaults when only the required variables are set', () => {
    const config = loadConfig(valid);

    expect(config).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 3000,
      corsOrigins: ['http://localhost:4200'],
      bodyLimit: '100kb',
    });
  });

  it('parses a comma-separated list of CORS origins', () => {
    const config = loadConfig({
      ...valid,
      CORS_ORIGINS: 'http://localhost:4200, https://app.example.com',
    });

    expect(config.corsOrigins).toEqual(['http://localhost:4200', 'https://app.example.com']);
  });

  it('fails fast when the database connection string is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it.each([
    ['PORT', 'not-a-number'],
    ['PORT', '70000'],
    ['MONGODB_URI', 'postgres://localhost/db'],
    ['CORS_ORIGINS', 'not a url'],
    ['LOG_LEVEL', 'verbose'],
    ['BODY_LIMIT', 'huge'],
  ])('rejects an invalid %s', (name, value) => {
    expect(() => loadConfig({ ...valid, [name]: value })).toThrow(ConfigError);
  });

  it('refuses to listen on a network address while there is no authentication (EXC-0001)', () => {
    expect(() => loadConfig({ ...valid, HOST: '0.0.0.0' })).toThrow(/loopback/);
  });

  it('allows a non-loopback host inside the container image', () => {
    expect(loadConfig({ ...valid, HOST: '0.0.0.0', CONTAINERIZED: 'true' }).host).toBe('0.0.0.0');
  });

  it('names the variable but never echoes its value in the error', () => {
    const sensitiveValue = 'not-a-connection-string-but-sensitive';

    expect(() => loadConfig({ MONGODB_URI: sensitiveValue })).toThrow(/MONGODB_URI/);
    try {
      loadConfig({ MONGODB_URI: sensitiveValue });
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveValue);
    }
  });
});
