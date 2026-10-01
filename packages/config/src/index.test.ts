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
});

