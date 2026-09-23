import assert from 'node:assert/strict';
import {
  EXPECT_PRESETS,
  extractFieldsFromHtml,
  webUnblockerHandler,
} from './tools/handlers/unblocker.mjs';

async function runTests() {
  console.log('🧪 Testing Bright Data Web Unlocker Integration with Manual Expect Elements...\n');

  // Test 1: Verify EXPECT_PRESETS catalogue
  console.log('  Testing EXPECT_PRESETS catalogue...');
  assert.ok(EXPECT_PRESETS.FORM_INPUTS, 'FORM_INPUTS preset must exist');
  assert.ok(EXPECT_PRESETS.SIGNUP_FORM, 'SIGNUP_FORM preset must exist');
  assert.ok(EXPECT_PRESETS.LOGIN_FORM, 'LOGIN_FORM preset must exist');
  assert.ok(EXPECT_PRESETS.CHECKOUT_FORM, 'CHECKOUT_FORM preset must exist');
  assert.ok(EXPECT_PRESETS.SPA_READY, 'SPA_READY preset must exist');
  assert.match(EXPECT_PRESETS.FORM_INPUTS, /input/, 'FORM_INPUTS contains input selector');
  console.log('  ✔ All EXPECT_PRESETS selectors verified.');

  // Test 2: Field Extraction from unblocked HTML
  console.log('  Testing extractFieldsFromHtml...');
  const sampleHtml = `
    <html>
      <body>
        <form id="signup-form">
          <input type="email" id="user-email" name="email" placeholder="Enter email" required />
          <input type="password" id="user-pass" name="password" autocomplete="new-password" />
          <select name="country">
            <option value="US">United States</option>
            <option value="AU">Australia</option>
          </select>
          <textarea name="bio" placeholder="Short bio"></textarea>
          <input type="hidden" name="csrf_token" value="abc123secret" />
          <input type="submit" value="Sign Up" />
        </form>
      </body>
    </html>
  `;
  const fields = extractFieldsFromHtml(sampleHtml);
  assert.equal(fields.length, 4, 'Should extract 4 visible fields (ignoring hidden & submit)');
  assert.equal(fields[0].selector, '#user-email');
  assert.equal(fields[0].kind, 'email');
  assert.equal(fields[1].selector, '#user-pass');
  assert.equal(fields[1].kind, 'password');
  assert.equal(fields[2].kind, 'select');
  assert.equal(fields[3].kind, 'text');
  console.log('  ✔ Field extraction correctly classified fields, filtered hidden/submit elements.');

  // Test 3: webUnblockerHandler URL required check
  console.log('  Testing webUnblockerHandler validation...');
  const errRes = JSON.parse(await webUnblockerHandler({}));
  assert.equal(errRes.ok, false);
  assert.match(errRes.error, /URL parameter is required/);
  console.log('  ✔ URL requirement validated.');

  // Test 4: Mock fetch call verifying x-unblock-expect header formatting
  console.log('  Testing payload construction and x-unblock-expect header...');
  const originalFetch = globalThis.fetch;
  let interceptedUrl = null;
  let interceptedInit = null;

  globalThis.fetch = async (url, init) => {
    interceptedUrl = url;
    interceptedInit = init;
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'x-luminati-req-id': 'req_mock_12345',
        'x-captcha-solved': 'true',
      }),
      text: async () => '<html><body><input type="text" name="first_name" /></body></html>',
    };
  };

  try {
    const rawRes = await webUnblockerHandler({
      url: 'https://example.com/signup',
      apiKey: 'test-key-mock',
      zone: 'my_unlocker_zone',
      expectElement: 'form input[type="email"]',
      country: 'AU',
      render: true,
      dataFormat: 'markdown',
    });

    const res = JSON.parse(rawRes);
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.captchaSolved, true);
    assert.equal(res.reqId, 'req_mock_12345');
    assert.equal(res.expectElement, 'form input[type="email"]');
    assert.equal(res.fieldsCount, 1);

    const body = JSON.parse(interceptedInit.body);
    assert.equal(body.zone, 'my_unlocker_zone');
    assert.equal(body.url, 'https://example.com/signup');
    assert.equal(body.render, 'true');
    assert.equal(body.data_format, 'markdown');
    assert.equal(body.country, 'au');
    assert.equal(
      body.headers['x-unblock-expect'],
      JSON.stringify({ element: 'form input[type="email"]' }),
      'x-unblock-expect must be JSON-serialized { element: selector }'
    );
    console.log('  ✔ x-unblock-expect correctly formatted and passed to Bright Data API!');

    // Test 5: Verify expectPreset resolution
    console.log('  Testing expectPreset resolution...');
    await webUnblockerHandler({
      url: 'https://example.com/login',
      apiKey: 'test-key-mock',
      expectPreset: 'LOGIN_FORM',
    });
    const body2 = JSON.parse(interceptedInit.body);
    assert.equal(
      body2.headers['x-unblock-expect'],
      JSON.stringify({ element: EXPECT_PRESETS.LOGIN_FORM }),
      'expectPreset must resolve to standard preset selector'
    );
    console.log('  ✔ expectPreset successfully mapped to EXPECT_PRESETS.LOGIN_FORM.');

    // Test 6: URL fragment extraction
    console.log('  Testing SPA URL fragment extraction (#)...');
    await webUnblockerHandler({
      url: 'https://spa-app.com/#!/register/step-2',
      apiKey: 'test-key-mock',
      expectElement: '.pace-done',
    });
    const body3 = JSON.parse(interceptedInit.body);
    assert.equal(body3.url, 'https://spa-app.com/');
    assert.equal(body3.headers['x-unblock-url-fragment'], '!/register/step-2');
    console.log('  ✔ Hash fragment extracted into x-unblock-url-fragment header.');

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n🎉 ALL BRIGHT DATA WEB UNLOCKER TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
