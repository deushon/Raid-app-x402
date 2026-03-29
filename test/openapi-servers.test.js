const { test } = require('node:test');
const assert = require('node:assert/strict');
const { swaggerSpec } = require('../src/docs/swagger');

test('OpenAPI servers[0] is relative so Swagger Try it out uses current host', () => {
  assert.ok(Array.isArray(swaggerSpec.servers) && swaggerSpec.servers.length > 0);
  assert.equal(
    swaggerSpec.servers[0].url,
    '/',
    'fixed http://localhost:3000 breaks /docs opened via LAN IP',
  );
});

test('OpenAPI documents teleoperator JWT lifetime and where it is required', () => {
  const teleopTag = swaggerSpec.tags.find((t) => t.name === 'Teleoperator');
  assert.ok(teleopTag);
  assert.match(teleopTag.description, /7 days/i);
  assert.match(teleopTag.description, /TELEOPERATOR_JWT_EXPIRES_IN/);
  assert.match(teleopTag.description, /\/api\/teleoperator\/me/);

  const bearer = swaggerSpec.components.securitySchemes.TeleoperatorBearer;
  assert.match(bearer.description, /help-requests/);
  assert.match(bearer.description, /7d/);

  const authSchema = swaggerSpec.components.schemas.TeleoperatorAuthResponse;
  assert.match(authSchema.properties.accessToken.description, /exp/);
});
