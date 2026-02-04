import { execSync } from 'child_process';

const HASURA = process.env.EXPO_PUBLIC_HASURA_URL;

describe('Hasura E2E (local)', () => {
  it('skips if no hasura URL configured', () => {
    if (!HASURA) {
      console.warn('Skipping Hasura e2e: EXPO_PUBLIC_HASURA_URL not set');
      return;
    }
  });

  it('responds to a posts query', () => {
    if (!HASURA) return;
    const cmd = `curl -s -X POST ${HASURA} -H "Content-Type: application/json" -d '{"query":"query Posts { posts { id caption } }"}'`;
    const out = execSync(cmd, { encoding: 'utf8' });
    const json = JSON.parse(out);
    expect(json).toBeDefined();
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data.posts)).toBe(true);
  });
});
