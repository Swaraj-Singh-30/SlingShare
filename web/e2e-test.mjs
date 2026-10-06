import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function runE2ETest() {
  console.log('--- Starting SlingShare End-to-End P2P Validation ---');

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox'],
  });

  try {
    // 1. Create two isolated browser contexts simulating two physical devices
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Log browser console for debugging
    pageA.on('console', (msg) => console.log('[Browser A]:', msg.text()));
    pageB.on('console', (msg) => console.log('[Browser B]:', msg.text()));

    // 2. Open /app on Device A
    console.log('[Test] Step 1: Navigating Device A to http://localhost:8080/app');
    await pageA.goto('http://localhost:8080/app', { waitUntil: 'networkidle' });

    // 3. Device A creates a session
    console.log('[Test] Step 2: Device A creating session...');
    await pageA.click('#createSessionBtn');
    await pageA.waitForSelector('#activeSessionCode:not(:has-text("------"))', { timeout: 5000 });

    const roomCode = (await pageA.textContent('#activeSessionCode')).trim();
    console.log(`[Test] Session created with room code: ${roomCode}`);
    if (!roomCode || roomCode.length !== 6) {
      throw new Error(`Invalid room code generated: "${roomCode}"`);
    }

    // 4. Open /app on Device B
    console.log('[Test] Step 3: Navigating Device B to http://localhost:8080/app');
    await pageB.goto('http://localhost:8080/app', { waitUntil: 'networkidle' });

    // 5. Device B joins session using room code
    console.log(`[Test] Step 4: Device B joining session ${roomCode}...`);
    await pageB.fill('#joinCodeInput', roomCode);
    await pageB.click('#joinSessionBtn');

    // 6. Verify WebRTC Connection on both devices
    console.log('[Test] Step 5: Waiting for WebRTC DataChannel connection...');
    await pageA.waitForSelector('.status-indicator.connected', { timeout: 8000 });
    await pageB.waitForSelector('.status-indicator.connected', { timeout: 8000 });
    console.log('✓ WebRTC connection established between Device A and Device B!');

    // 7. Test Text Transfer (A -> B)
    console.log('[Test] Step 6: Testing text transfer A -> B...');
    await pageA.click('#tabTextBtn');
    await pageB.click('#tabTextBtn');

    const testMessageA = 'Hello from Device A! WebRTC DTLS encrypted payload.';
    await pageA.fill('#textShareInput', testMessageA);
    await pageA.click('#sendTextBtn');

    await pageB.waitForSelector(`.message-body:has-text("${testMessageA}")`, { timeout: 5000 });
    console.log('✓ Device B received text message successfully!');

    // 8. Test Text Transfer (B -> A)
    console.log('[Test] Step 7: Testing text transfer B -> A...');
    const testMessageB = 'Response from Device B! Integrity confirmed.';
    await pageB.fill('#textShareInput', testMessageB);
    await pageB.click('#sendTextBtn');

    await pageA.waitForSelector(`.message-body:has-text("${testMessageB}")`, { timeout: 5000 });
    console.log('✓ Device A received response message successfully!');

    // 9. Test File Transfer with Chunking and SHA-256 (A -> B)
    console.log('[Test] Step 8: Testing chunked file transfer with SHA-256 integrity (A -> B)...');
    await pageA.click('#tabFilesBtn');
    await pageB.click('#tabFilesBtn');

    // Create a dummy test file (150 KB to ensure multiple 64 KB chunks)
    const testFilePath = path.join(process.cwd(), 'scratch-test-file.bin');
    const testData = Buffer.alloc(150 * 1024, 'SlingShare Test File Chunking Protocol Validation 1234567890 ');
    fs.writeFileSync(testFilePath, testData);

    await pageA.setInputFiles('#fileInput', testFilePath);

    // Wait for transfer to complete on both sides
    console.log('[Test] Waiting for transfer completion and SHA-256 verification...');
    await pageA.waitForSelector('.badge-success:has-text("Complete & Verified")', { timeout: 10000 });
    await pageB.waitForSelector('.badge-success:has-text("Complete & Verified")', { timeout: 10000 });
    console.log('✓ File transfer completed and verified with SHA-256!');

    // Cleanup scratch file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    // 10. Test Peer Disconnect
    console.log('[Test] Step 9: Testing peer leave / disconnect...');
    await pageB.click('#leaveSessionBtn');

    await pageA.waitForSelector('.status-indicator.disconnected', { timeout: 5000 });
    console.log('✓ Disconnect handled cleanly!');

    console.log('\n==================================================');
    console.log('>>> ALL END-TO-END ACCEPTANCE CRITERIA PASSED! <<<');
    console.log('==================================================\n');

    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    await browser.close();
    process.exit(1);
  }
}

runE2ETest();
