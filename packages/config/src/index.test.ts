import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './index.js';

const valid = {
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/rcs',
  REDIS_URL: 'redis://localhost:6379'
};

describe('loadServerConfig', () => {
  it('falha sem infraestrutura configurada', () => {
    expect(() => loadServerConfig({})).toThrow('Configuração inválida');
  });

  it('aceita configuração válida e aplica padrões seguros', () => {
    expect(loadServerConfig(valid)).toMatchObject({ API_PORT: 3001, NODE_ENV: 'development' });
  });

  it('rejeita protocolos de banco incompatíveis', () => {
    expect(() => loadServerConfig({ ...valid, DATABASE_URL: 'http://localhost' })).toThrow();
  });

  it('exige HTTPS na interface em produção e rejeita origens com credenciais ou caminhos', () => {
    expect(() => loadServerConfig({ ...valid, NODE_ENV: 'production' })).toThrow();
    expect(loadServerConfig({ ...valid, NODE_ENV: 'production', APP_URL: 'https://app.example.test',
      RCS_EDGE_PROXY_SECRET: 'a'.repeat(64), RCS_API_PROXY_SECRET: 'b'.repeat(64) }).APP_URL).toBe('https://app.example.test');
    for (const APP_URL of ['ftp://localhost', 'http://user:secret@localhost', 'http://localhost/path']) {
      expect(() => loadServerConfig({ ...valid, APP_URL })).toThrow();
    }
  });
  it('requires distinct proxy secrets in production and rejects partial configuration without leaking values', () => {
    for (const secrets of [{}, { RCS_EDGE_PROXY_SECRET: 'a'.repeat(64) },
      { RCS_EDGE_PROXY_SECRET: 'a'.repeat(64), RCS_API_PROXY_SECRET: 'a'.repeat(64) },
      { RCS_EDGE_PROXY_SECRET: 'a'.repeat(64), RCS_API_PROXY_SECRET: 'short-secret' }]) {
      expect(() => loadServerConfig({ ...valid, NODE_ENV: 'production', APP_URL: 'https://app.example.test', ...secrets }))
        .toThrow('Configuração inválida');
    }
  });
});
