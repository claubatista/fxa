/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const assert = require('../assert');
const TestServer = require('../test_server');
const Client = require('../client')();
const config = require('../../config').getProperties();
const otplib = require('otplib');

describe('remote account create with sign-up code', function() {
  this.timeout(15000);
  const password = '4L6prUdlLNfxGIoj';
  let server, client, email, emailStatus, emailData;

  before(async () => {
    server = await TestServer.start(config);
    return server;
  });

  it('create and verify sync account', async () => {
    email = server.uniqueEmail();

    client = await Client.create(config.publicUrl, email, password, {
      service: 'sync',
      verificationMethod: 'email-otp',
    });
    assert.ok(client.authAt, 'authAt was set');

    emailStatus = await client.emailStatus();
    assert.equal(emailStatus.verified, false);

    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');
    assert.include(emailData.html, 'IP address');

    await client.verifyShortCodeEmail(
      emailData.headers['x-verify-short-code'],
      {
        service: 'sync',
      }
    );

    emailData = await server.mailbox.waitForEmail(email);
    assert.include(emailData.headers['x-link'], config.smtp.syncUrl);

    emailStatus = await client.emailStatus();
    assert.equal(emailStatus.verified, true);
  });

  it('create and verify account', async () => {
    email = server.uniqueEmail();

    client = await Client.create(config.publicUrl, email, password, {
      verificationMethod: 'email-otp',
    });
    assert.ok(client.authAt, 'authAt was set');

    emailStatus = await client.emailStatus();
    assert.equal(emailStatus.verified, false);

    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');
    assert.include(emailData.html, 'IP address');

    await client.verifyShortCodeEmail(emailData.headers['x-verify-short-code']);

    emailStatus = await client.emailStatus();
    assert.equal(emailStatus.verified, true);

    // It's hard to test for "an email didn't arrive".
    // Instead trigger sending of another email and test
    // that there wasn't anything in the queue before it.
    await client.forgotPassword();

    const code = await server.mailbox.waitForCode(email);
    assert.ok(code, 'the next email was reset-password, not post-verify');
  });

  it('throws for expired code', async () => {
    // To generate an expired code, you have to retrieve the accounts `emailCode`
    // and create the otp authenticator with the previous time window.
    email = server.uniqueEmail();

    client = await Client.create(config.publicUrl, email, password, {
      verificationMethod: 'email-otp',
    });
    assert.ok(client.authAt, 'authAt was set');

    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');

    await client.requestVerifyEmail();
    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyEmail');

    const secret = emailData.headers['x-verify-code'];
    const futureAuthenticator = new otplib.authenticator.Authenticator();
    futureAuthenticator.options = Object.assign(
      {},
      otplib.authenticator.options,
      config.otp,
      { secret, epoch: Date.now() / 1000 - 600 }
    );
    const expiredCode = futureAuthenticator.generate();

    await assert.failsAsync(client.verifyShortCodeEmail(expiredCode), {
      code: 400,
      errno: 183,
    });
  });

  it('throws for invalid code', async () => {
    email = server.uniqueEmail();

    client = await Client.create(config.publicUrl, email, password, {
      verificationMethod: 'email-otp',
    });
    assert.ok(client.authAt, 'authAt was set');

    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');
    assert.include(emailData.html, 'IP address');

    const invalidCode = emailData.headers['x-verify-short-code'] + 1;

    await assert.failsAsync(client.verifyShortCodeEmail(invalidCode), {
      code: 400,
      errno: 183,
    });
  });

  it('create and resend authentication code', async () => {
    email = server.uniqueEmail();

    client = await Client.create(config.publicUrl, email, password, {
      verificationMethod: 'email-otp',
    });

    emailData = await server.mailbox.waitForEmail(email);
    const originalMessageId = emailData['messageId'];
    const originalCode = emailData.headers['x-verify-short-code'];

    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');
    assert.include(emailData.html, 'IP address');

    await client.resendVerifyShortCodeEmail();

    emailData = await server.mailbox.waitForEmail(email);
    assert.equal(emailData.headers['x-template-name'], 'verifyShortCodeEmail');
    assert.include(emailData.html, 'IP address');

    assert.notEqual(
      originalMessageId,
      emailData['messageId'],
      'different email was sent'
    );
    assert.equal(
      originalCode,
      emailData.headers['x-verify-short-code'],
      'codes match'
    );
  });

  after(() => {
    return TestServer.stop(server);
  });
});
