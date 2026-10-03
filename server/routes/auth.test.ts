import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';
import { hashSecret, verifySecret, getInstallSalt } from './auth.js';

describe('Auth Router — Real HTTP Integration Tests & scrypt Hardening', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('generates a per-install cryptographic salt and hashes secrets using scrypt', () => {
    const db = getDb();
    const salt1 = getInstallSalt(db);
    expect(salt1).toHaveLength(32); // 16 bytes in hex

    // Second call retrieves the exact same salt from settings
    const salt2 = getInstallSalt(db);
    expect(salt2).toBe(salt1);

    const hash = hashSecret('1234', salt1);
    expect(hash).toHaveLength(128); // 64 bytes in hex
    expect(verifySecret('1234', hash, salt1)).toBe(true);
    expect(verifySecret('9999', hash, salt1)).toBe(false);
  });

  it('GET /api/auth/status returns unconfigured and locked on fresh install without defaulting credentials', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.locked).toBe(true);

    // Verify settings has no default credentials
    const db = getDb();
    const pinRow = db.prepare(`SELECT value FROM settings WHERE key = 'pin_hash'`).get();
    expect(pinRow).toBeUndefined();
  });

  it('POST /api/auth/unlock rejects unlocking when unconfigured', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ pin: '1234' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('POST /api/auth/setup validates 4-digit PIN and minimum password length', async () => {
    // 1. PIN too short
    const resShortPin = await request(app)
      .post('/api/auth/setup')
      .send({ pin: '12', password: 'validpassword' });
    expect(resShortPin.status).toBe(400);
    expect(resShortPin.body.error).toMatch(/4 digits/i);

    // 2. Non-numeric PIN
    const resAlphaPin = await request(app)
      .post('/api/auth/setup')
      .send({ pin: 'abcd', password: 'validpassword' });
    expect(resAlphaPin.status).toBe(400);

    // 3. Password too short
    const resShortPass = await request(app)
      .post('/api/auth/setup')
      .send({ pin: '1234', password: 'abc' });
    expect(resShortPass.status).toBe(400);
    expect(resShortPass.body.error).toMatch(/at least 4 characters/i);
  });

  it('POST /api/auth/setup configures PIN, Master Password, and shop metadata with scrypt hashing', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({
        pin: '4321',
        password: 'masterRecoveryKey123',
        shop_name: 'Al Jazira SHSP Sfax',
        tax_id: '1234567/M'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pin_hash).toBeDefined();

    // Verify database state
    const db = getDb();
    const pinRow: any = db.prepare(`SELECT value FROM settings WHERE key = 'pin_hash'`).get();
    const masterRow: any = db.prepare(`SELECT value FROM settings WHERE key = 'master_password_hash'`).get();
    const shopRow: any = db.prepare(`SELECT value FROM settings WHERE key = 'shop_name'`).get();

    expect(pinRow.value).toHaveLength(128);
    expect(masterRow.value).toHaveLength(128);
    expect(shopRow.value).toBe('Al Jazira SHSP Sfax');

    // Status now reports configured and unlocked
    const statusRes = await request(app).get('/api/auth/status');
    expect(statusRes.body.configured).toBe(true);
    expect(statusRes.body.locked).toBe(false);
  });

  it('POST /api/auth/lock and POST /api/auth/unlock manage session lock state', async () => {
    // 1. Initial setup
    await request(app)
      .post('/api/auth/setup')
      .send({ pin: '5566', password: 'adminPassword123' });

    // 2. Lock the session
    const lockRes = await request(app).post('/api/auth/lock');
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.locked).toBe(true);

    const statusLocked = await request(app).get('/api/auth/status');
    expect(statusLocked.body.locked).toBe(true);

    // 3. Attempt unlock with wrong PIN -> 401
    const wrongUnlock = await request(app)
      .post('/api/auth/unlock')
      .send({ pin: '0000' });
    expect(wrongUnlock.status).toBe(401);

    // 4. Unlock with correct PIN -> 200
    const correctUnlock = await request(app)
      .post('/api/auth/unlock')
      .send({ pin: '5566' });
    expect(correctUnlock.status).toBe(200);
    expect(correctUnlock.body.success).toBe(true);

    const statusUnlocked = await request(app).get('/api/auth/status');
    expect(statusUnlocked.body.locked).toBe(false);

    // 5. Lock and unlock using Master Password
    await request(app).post('/api/auth/lock');
    const masterUnlock = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'adminPassword123' });
    expect(masterUnlock.status).toBe(200);
    expect(masterUnlock.body.success).toBe(true);
  });

  it('POST /api/auth/change updates credentials only with valid current authentication', async () => {
    // 1. Initial setup
    await request(app)
      .post('/api/auth/setup')
      .send({ pin: '1122', password: 'oldMasterKey' });

    // 2. Reject change with wrong current secret
    const badChange = await request(app)
      .post('/api/auth/change')
      .send({ current_secret: 'wrong', new_pin: '9988' });
    expect(badChange.status).toBe(401);

    // 3. Successfully change PIN
    const goodChange = await request(app)
      .post('/api/auth/change')
      .send({ current_secret: '1122', new_pin: '9988' });
    expect(goodChange.status).toBe(200);

    // 4. Old PIN fails, new PIN succeeds
    await request(app).post('/api/auth/lock');
    const oldAttempt = await request(app).post('/api/auth/unlock').send({ pin: '1122' });
    expect(oldAttempt.status).toBe(401);

    const newAttempt = await request(app).post('/api/auth/unlock').send({ pin: '9988' });
    expect(newAttempt.status).toBe(200);
  });
});
