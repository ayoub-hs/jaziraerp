import { describe, it, expect } from 'vitest';
import { app, request } from '../../tests/testApp.js';

describe('Step 8: Version Check Endpoint', () => {
  it('GET /api/version returns version, build_id, and ISO timestamp', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('build_id');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.build_id).toBe('string');
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });
});
