const crypto = require('crypto');

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function getSecret() {
  return process.env.AUTH_SECRET || 'strikz-club-dev-secret';
}

function getConfiguredAdmin() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'strikz123',
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createToken(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    throw new Error('Invalid token');
  }

  const [body, signature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid token');
  }

  const payload = JSON.parse(base64UrlDecode(body));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error('Token expired');
  }

  return payload;
}

function issueAdminToken(username) {
  return createToken({
    sub: username,
    role: 'admin',
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
}

function createQrToken() {
  const raw = crypto.randomBytes(24).toString('hex');
  return `strikz_${raw}`;
}

module.exports = {
  createQrToken,
  getConfiguredAdmin,
  issueAdminToken,
  safeEqual,
  verifyToken,
};
