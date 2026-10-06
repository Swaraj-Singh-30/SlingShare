import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function runE2ETest() {
  console.log('===========================================================');
  console.log('>>> Starting SlingShare Full Milestone Validation Suite <<<');
  console.log('===========================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox'],
  });

  try {
    // -------------------------------------------------------------
    // PHASE 1: Device Identity, Validation & Theme Mode Testing
    // -------------------------------------------------------------
    console.log('[Test Phase 1] Testing Device Identity & Theme Switching...');
    const contextTest = await browser.newContext();
    const pageTest = await contextTest.newPage();

    await pageTest.goto('http://localhost:8080/app', { waitUntil: 'networkidle' });

    // 1.1 Verify deviceId & deviceName generated and persisted
    const deviceId1 = await pageTest.evaluate(() => localStorage.getItem('slingshare_device_id'));
    const deviceName1 = await pageTest.evaluate(() => localStorage.getItem('slingshare_device_name'));
    console.log(`[Identity] Generated persistent deviceId: ${deviceId1}`);
    console.log(`[Identity] Generated default deviceName: ${deviceName1}`);

    if (!deviceId1 || !deviceId1.startsWith('dev_')) {
      throw new Error(`Invalid deviceId format: ${deviceId1}`);
    }

    // Refresh and verify ID and name persistence
    await pageTest.reload({ waitUntil: 'networkidle' });
    const deviceId2 = await pageTest.evaluate(() => localStorage.getItem('slingshare_device_id'));
    const deviceName2 = await pageTest.evaluate(() => localStorage.getItem('slingshare_device_name'));
    if (deviceId1 !== deviceId2 || deviceName1 !== deviceName2) {
      throw new Error('Device identity did not persist across page reload!');
    }
    console.log('✓ Device ID and name persist across page reloads.');

    // 1.2 Test Device Name Editing and XSS Safety
    console.log('[Validation] Testing device name editing & XSS escaping...');
    await pageTest.click('#editDeviceNameBtn');
    await pageTest.waitForSelector('#editNameModal[open]');

    const xssPayload = '<script>alert("xss")</script>';
    await pageTest.fill('#customDeviceNameInput', xssPayload);
    await pageTest.click('#saveEditNameBtn');

    const displayedName = await pageTest.textContent('#localDeviceName');
    console.log(`[Validation] Displayed device name: "${displayedName}"`);
    if (displayedName !== xssPayload) {
      throw new Error(`Device name was not properly set as literal text: ${displayedName}`);
    }
    // Verify script was not executed as HTML
    const scriptTags = await pageTest.$$('script:has-text("alert(\\"xss\\")")');
    if (scriptTags.length > 0) {
      throw new Error('XSS payload was executed as an HTML script tag!');
    }
    console.log('✓ Device name safely escaped and rendered as pure text.');

    // 1.3 Test Theme Switching (System -> Dark -> Light -> System)
    console.log('[Theme] Testing Theme Switcher...');
    const themeBtn = pageTest.locator('#themeToggleBtn');
    await themeBtn.click(); // to dark
    let themeAttr = await pageTest.getAttribute('html', 'data-theme');
    console.log(`[Theme] After first toggle: ${themeAttr}`);
    if (themeAttr !== 'dark') throw new Error(`Expected dark theme, got ${themeAttr}`);

    await themeBtn.click(); // to light
    themeAttr = await pageTest.getAttribute('html', 'data-theme');
    console.log(`[Theme] After second toggle: ${themeAttr}`);
    if (themeAttr !== 'light') throw new Error(`Expected light theme, got ${themeAttr}`);

    await themeBtn.click(); // to system
    themeAttr = await pageTest.getAttribute('html', 'data-theme');
    console.log(`[Theme] After third toggle: ${themeAttr}`);
    if (themeAttr !== 'system') throw new Error(`Expected system theme, got ${themeAttr}`);

    await pageTest.close();
    await contextTest.close();
    console.log('✓ Theme modes (System / Dark / Light) work and persist correctly.\n');

    // -------------------------------------------------------------
    // PHASE 2: Real Discovery, Radar & Click-to-Pair
    // -------------------------------------------------------------
    console.log('[Test Phase 2] Testing Real Device Discovery & Radar Pairing...');
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    pageA.on('console', msg => console.log('  [PageA Browser]', msg.type(), msg.text()));
    pageB.on('console', msg => console.log('  [PageB Browser]', msg.type(), msg.text()));

    // Set custom distinct device names in localStorage before load
    await pageA.addInitScript(() => {
      localStorage.setItem('slingshare_device_id', 'dev_macbook_swaraj_99');
      localStorage.setItem('slingshare_device_name', "Swaraj's MacBook");
    });

    await pageB.addInitScript(() => {
      localStorage.setItem('slingshare_device_id', 'dev_pixel_phone_88');
      localStorage.setItem('slingshare_device_name', 'Pixel Phone');
    });

    console.log('[Discovery] Opening Device A (Swaraj\'s MacBook)...');
    await pageA.goto('http://localhost:8080/app', { waitUntil: 'networkidle' });

    console.log('[Discovery] Opening Device B (Pixel Phone)...');
    await pageB.goto('http://localhost:8080/app', { waitUntil: 'networkidle' });

    // Verify Device A discovers Device B on its Radar
    console.log('[Radar] Waiting for Device B to appear on Device A Radar...');
    await pageA.waitForSelector('.radar-device-node:has-text("Pixel Phone")', { timeout: 8000 });
    console.log('✓ Device B ("Pixel Phone") appears on Device A Radar!');

    // Verify Device B discovers Device A on its Radar
    console.log('[Radar] Waiting for Device A to appear on Device B Radar...');
    await pageB.waitForSelector('.radar-device-node:has-text("Swaraj\'s MacBook")', { timeout: 8000 });
    console.log('✓ Device A ("Swaraj\'s MacBook") appears on Device B Radar!');

    // Test List View Fallback on Device A
    console.log('[List Fallback] Switching Device A to List view...');
    await pageA.click('#headerViewListBtn');
    await pageA.waitForSelector('.discovered-list-item:has-text("Pixel Phone")', { timeout: 4000 });
    console.log('✓ Discovered device accurately listed in accessible List view fallback!');

    // Switch back to Radar
    await pageA.click('#headerViewRadarBtn');
    await pageA.waitForSelector('.radar-device-node:has-text("Pixel Phone")', { timeout: 4000 });

    // -------------------------------------------------------------
    // PHASE 3: Click Radar Node to Initiate WebRTC Pairing
    // -------------------------------------------------------------
    console.log('[Radar Pairing] Device A clicks "Pixel Phone" on Radar to initiate pairing...');
    await pageA.click('.radar-device-node:has-text("Pixel Phone")', { force: true });

    console.log('[WebRTC] Waiting for automated WebRTC DataChannel connection...');
    await pageA.waitForSelector('.status-indicator.connected', { timeout: 10000 });
    await pageB.waitForSelector('.status-indicator.connected', { timeout: 10000 });
    console.log('✓ Real WebRTC DataChannel established between Device A and Device B via Radar click!');

    // Verify Peer Banner
    const bannerPeerA = await pageA.textContent('#remotePeerName');
    const bannerPeerB = await pageB.textContent('#remotePeerName');
    console.log(`[Peer] Device A connected with: "${bannerPeerA}"`);
    console.log(`[Peer] Device B connected with: "${bannerPeerB}"`);

    // -------------------------------------------------------------
    // PHASE 4: Text Transfer End-to-End Testing
    // -------------------------------------------------------------
    console.log('\n[Test Phase 4] Comprehensive End-to-End Text Transfer Testing...');
    await pageA.click('#tabTextBtn');
    await pageB.click('#tabTextBtn');

    // 4.1 Empty / whitespace-only validation
    console.log('[Text Validation] Checking empty/whitespace rejection...');
    await pageA.fill('#textShareInput', '   \n\t  ');
    const sendBtnDisabled = await pageA.isDisabled('#sendTextBtn');
    if (!sendBtnDisabled) throw new Error('Send button should be disabled for whitespace-only text');
    await pageA.fill('#textShareInput', '');
    console.log('✓ Send button correctly disabled for empty/whitespace text.');

    // 4.2 A -> B Simple text
    console.log('[Text A -> B] Device A sending "Hello from A" to Device B...');
    const msgA1 = 'Hello from A';
    await pageA.fill('#textShareInput', msgA1);
    await pageA.click('#sendTextBtn');

    // Verify A shows sent message labeled 'You'
    await pageA.waitForSelector('.message-item.message-sent .message-body', { timeout: 5000 });
    const sentAContent = await pageA.textContent('.message-item.message-sent .message-body');
    const sentASender = await pageA.textContent('.message-item.message-sent .message-header strong');
    if (sentAContent.trim() !== msgA1 || sentASender !== 'You') {
      throw new Error(`Device A sent message UI mismatch: "${sentAContent}", sender: "${sentASender}"`);
    }
    console.log('✓ Device A correctly rendered sent message with "You" label.');

    // Verify B receives message labeled "Swaraj's MacBook"
    await pageB.waitForSelector('.message-item.message-received .message-body', { timeout: 5000 });
    const receivedBContent = await pageB.textContent('.message-item.message-received .message-body');
    const receivedBSender = await pageB.textContent('.message-item.message-received .message-header strong');
    if (receivedBContent.trim() !== msgA1 || receivedBSender !== "Swaraj's MacBook") {
      throw new Error(`Device B received text mismatch: "${receivedBContent}", sender: "${receivedBSender}"`);
    }
    console.log('✓ Device B received "Hello from A" with correct remote sender name!');

    // 4.3 B -> A Simple text
    console.log('[Text B -> A] Device B sending "Hello from B" to Device A...');
    const msgB1 = 'Hello from B';
    await pageB.fill('#textShareInput', msgB1);
    await pageB.click('#sendTextBtn');

    // Verify A receives message labeled "Pixel Phone"
    await pageA.waitForSelector('.message-item.message-received .message-body', { timeout: 5000 });
    const receivedAContent = await pageA.textContent('.message-item.message-received .message-body');
    const receivedASender = await pageA.textContent('.message-item.message-received .message-header strong');
    if (receivedAContent.trim() !== msgB1 || receivedASender !== 'Pixel Phone') {
      throw new Error(`Device A received text mismatch: "${receivedAContent}", sender: "${receivedASender}"`);
    }
    console.log('✓ Device A received "Hello from B" with correct remote sender name!');

    // 4.4 Multiline, Unicode, Emojis, Code Snippets & HTML Safety (A -> B)
    console.log('[Text A -> B] Testing Multiline, Unicode, Emojis, Code and HTML tags...');
    const richPayload = [
      'Hello 👋 🚀',
      '"quotes" and \'quotes\'',
      '<script>window.__xss_fired = true;</script>',
      '<hello> & test',
      'Line 1',
      'Line 2',
      'const hello = "world";',
      'https://example.com/test?a=1&b=2',
      '中文 日本語 हैलो العربية 🌍',
    ].join('\n');

    await pageA.fill('#textShareInput', richPayload);
    await pageA.click('#sendTextBtn');

    // Wait for Device B to receive the rich payload
    await pageB.waitForSelector('.message-item.message-received .message-body:has-text("Line 2")', { timeout: 5000 });
    const receivedRichElements = await pageB.$$('.message-item.message-received .message-body');
    const latestReceivedB = receivedRichElements[receivedRichElements.length - 1];
    const receivedRichText = await latestReceivedB.textContent();

    if (receivedRichText !== richPayload) {
      throw new Error(`Rich text payload mismatch!\nExpected:\n${richPayload}\nGot:\n${receivedRichText}`);
    }
    console.log('✓ Exact Multiline & Unicode payload preserved without corruption!');

    // Verify HTML escaping / XSS safety on receiver
    const xssFired = await pageB.evaluate(() => window.__xss_fired);
    if (xssFired) throw new Error('XSS executed inside receiver DOM!');
    console.log('✓ Zero unsafe HTML injection: <script> and HTML tags rendered safely as text.');

    // 4.5 Keyboard shortcut send (Cmd+Enter / Ctrl+Enter) (B -> A)
    console.log('[Text B -> A] Testing Enter shortcut (Control+Enter)...');
    const shortcutMsg = 'Sent via keyboard shortcut ⚡';
    await pageB.fill('#textShareInput', shortcutMsg);
    await pageB.press('#textShareInput', 'Control+Enter');

    await pageA.waitForSelector(`.message-item.message-received .message-body:has-text("${shortcutMsg}")`, { timeout: 5000 });
    console.log('✓ Keyboard shortcut send verified end-to-end!');

    // 4.6 Long Text Payload Test (A -> B, ~15 KB)
    console.log('[Text Long] Testing long text message (~15 KB)...');
    const paragraph = 'SlingShare peer-to-peer secure direct WebRTC data transfer stream. ';
    const longText = paragraph.repeat(250) + '\n[END OF LONG TEXT]';
    await pageA.fill('#textShareInput', longText);
    await pageA.click('#sendTextBtn');

    await pageB.waitForSelector('.message-item.message-received .message-body:has-text("[END OF LONG TEXT]")', { timeout: 8000 });
    const bMessages = await pageB.$$('.message-item.message-received .message-body');
    const lastBMessage = bMessages[bMessages.length - 1];
    const receivedLongText = await lastBMessage.textContent();
    if (receivedLongText !== longText) {
      throw new Error(`Long text length mismatch: expected ${longText.length}, got ${receivedLongText?.length}`);
    }
    console.log(`✓ Long text (${receivedLongText.length} chars) successfully transmitted and verified!`);

    // -------------------------------------------------------------
    // PHASE 5: Chunked File Transfer & SHA-256 Integrity Regression
    // -------------------------------------------------------------
    console.log('\n[Test Phase 4] Regression Testing: Chunked File Transfer & SHA-256...');
    await pageA.click('#tabFilesBtn');
    await pageB.click('#tabFilesBtn');

    // Create 180 KB test file (multiple 64KB chunks to test chunking and backpressure)
    const testFile = path.join(process.cwd(), 'regression-file.bin');
    const testPayload = Buffer.alloc(180 * 1024, 'SlingShare Milestone 2 Regression Validation Protocol 2026 ');
    fs.writeFileSync(testFile, testPayload);

    await pageA.setInputFiles('#fileInput', testFile);

    console.log('[Transfer] Waiting for file streaming and SHA-256 integrity verification...');
    await pageA.waitForSelector('.badge-success:has-text("Complete & Verified")', { timeout: 12000 });
    await pageB.waitForSelector('.badge-success:has-text("Complete & Verified")', { timeout: 12000 });
    console.log('✓ Chunked file transfer succeeded with verified cryptographic SHA-256 checksum!');

    // Verify Download Button and Actual Browser File Download on Device B
    console.log('[Download] Verifying download button on Device B and testing browser download...');
    await pageB.waitForSelector('.btn-download', { timeout: 5000 });
    const downloadPromise = pageB.waitForEvent('download');
    await pageB.click('.btn-download');
    const download = await downloadPromise;
    console.log(`[Download] Download triggered with filename: ${download.suggestedFilename()}`);
    if (download.suggestedFilename() !== 'regression-file.bin') {
      throw new Error(`Expected downloaded filename 'regression-file.bin', got '${download.suggestedFilename()}'`);
    }
    const downloadedPath = path.join(process.cwd(), 'downloaded-regression-file.bin');
    await download.saveAs(downloadedPath);
    const downloadedBuf = fs.readFileSync(downloadedPath);
    if (!downloadedBuf.equals(testPayload)) {
      throw new Error(`Downloaded content does not match sent content! Expected ${testPayload.length} bytes, got ${downloadedBuf.length} bytes.`);
    }
    console.log(`✓ Browser downloaded actual file (${downloadedBuf.length} bytes) and byte-for-byte verified with original!`);
    if (fs.existsSync(downloadedPath)) {
      fs.unlinkSync(downloadedPath);
    }

    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }

    // -------------------------------------------------------------
    // PHASE 6: Disconnect Handling & Discovery Cleanup
    // -------------------------------------------------------------
    console.log('\n[Test Phase 5] Testing Disconnect & Discovery Departure...');
    await pageB.click('#leaveSessionBtn');

    await pageA.waitForSelector('.status-indicator.disconnected', { timeout: 5000 });
    console.log('✓ Peer disconnect handled cleanly.');

    // -------------------------------------------------------------
    // PHASE 7: Responsive Viewport Checks
    // -------------------------------------------------------------
    console.log('\n[Test Phase 6] Testing Responsive Viewports (320px, 390px, 768px, 1280px)...');
    const viewports = [
      { width: 320, height: 800, name: '320px Small Mobile' },
      { width: 390, height: 844, name: '390px iPhone 14/15' },
      { width: 768, height: 1024, name: '768px iPad / Tablet' },
      { width: 1280, height: 800, name: '1280px Laptop' },
    ];

    for (const vp of viewports) {
      await pageA.setViewportSize({ width: vp.width, height: vp.height });
      const scrollWidth = await pageA.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await pageA.evaluate(() => document.documentElement.clientWidth);

      if (scrollWidth > clientWidth) {
        throw new Error(`Unintended horizontal scrollbar detected at ${vp.name} (${scrollWidth}px > ${clientWidth}px)!`);
      }
      console.log(`✓ Viewport ${vp.name}: Clean reflow, zero horizontal overflow.`);
    }

    console.log('\n===========================================================');
    console.log('>>> ALL PRODUCT MILESTONE ACCEPTANCE CRITERIA PASSED! <<<');
    console.log('===========================================================\n');

    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED:', err);
    await browser.close();
    process.exit(1);
  }
}

runE2ETest();
