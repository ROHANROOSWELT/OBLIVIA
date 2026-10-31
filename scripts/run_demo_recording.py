import asyncio
import os
import time
import subprocess
from playwright.async_api import async_playwright

VIDEO_DIR = '/tmp/oblivia_record'
FINAL_VIDEO = '/home/rohan/Desktop/bli/oblivia-protocol/oblivia-demo-3min.mp4'
AUDIO_FILE = '/tmp/oblivia_master_audio_180s.mp3'

os.makedirs(VIDEO_DIR, exist_ok=True)

# Helper: smooth mouse move
async def smooth_move(page, start_x, start_y, end_x, end_y, duration=0.8, steps=25):
    delay = duration / steps
    for i in range(1, steps + 1):
        x = start_x + (end_x - start_x) * (i / steps)
        y = start_y + (end_y - start_y) * (i / steps)
        await page.mouse.move(x, y)
        await asyncio.sleep(delay)

# Helper: smooth scroll
async def smooth_scroll(page, start_y, end_y, duration=1.2, steps=30):
    delay = duration / steps
    for i in range(1, steps + 1):
        y = start_y + (end_y - start_y) * (i / steps)
        await page.evaluate(f'window.scrollTo({{ top: {y}, behavior: "instant" }})')
        await asyncio.sleep(delay)

async def wait_until_elapsed(start_time, target_sec):
    elapsed = time.time() - start_time
    rem = target_sec - elapsed
    if rem > 0:
        await asyncio.sleep(rem)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path='/usr/bin/google-chrome',
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-size=1920,1080',
            ]
        )

        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            record_video_dir=VIDEO_DIR,
            record_video_size={'width': 1920, 'height': 1080},
            device_scale_factor=1,
        )

        page = await context.new_page()

        # Inject virtual cursor script for visual presentation
        await page.add_init_script("""
            window.addEventListener('DOMContentLoaded', () => {
                if (document.getElementById('demo-virtual-cursor')) return;
                const cursor = document.createElement('div');
                cursor.id = 'demo-virtual-cursor';
                cursor.style.cssText = `
                    position: fixed;
                    top: 0; left: 0;
                    width: 22px; height: 22px;
                    border-radius: 50%;
                    background: rgba(43, 90, 240, 0.75);
                    border: 2px solid #ffffff;
                    box-shadow: 0 0 12px rgba(0,0,0,0.35);
                    pointer-events: none;
                    z-index: 99999999;
                    transform: translate(-50%, -50%);
                    transition: transform 0.08s ease-out, background 0.15s ease;
                `;
                document.body.appendChild(cursor);
                window.addEventListener('mousemove', (e) => {
                    cursor.style.left = e.clientX + 'px';
                    cursor.style.top = e.clientY + 'px';
                });
                window.addEventListener('mousedown', () => {
                    cursor.style.transform = 'translate(-50%, -50%) scale(0.7)';
                    cursor.style.background = 'rgba(235, 60, 60, 0.95)';
                });
                window.addEventListener('mouseup', () => {
                    cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                    cursor.style.background = 'rgba(43, 90, 240, 0.75)';
                });
            });
        """)

        start_time = time.time()
        print(f"[{time.strftime('%X')}] Starting 3-minute recorded walkthrough...")

        # =========================================================================
        # SCENE 1: Introduction, Problem Statement & Global Privacy Crisis (0.00s - 29.61s)
        # =========================================================================
        print("--- SCENE 1: Introduction & Landing Page ---")
        await page.goto('http://127.0.0.1:3000/')
        await page.mouse.move(500, 350)
        await asyncio.sleep(2.0)

        # Smooth glide over hero problem statement
        await smooth_move(page, 500, 350, 750, 420, duration=2.5)
        await asyncio.sleep(1.0)

        # Smooth scroll down to statutory compliance crisis
        await smooth_scroll(page, 0, 720, duration=3.0)
        await smooth_move(page, 750, 420, 960, 500, duration=2.0)
        await asyncio.sleep(2.0)

        # Scroll down to architecture comparison
        await smooth_scroll(page, 720, 1400, duration=3.5)
        await smooth_move(page, 960, 500, 800, 450, duration=2.0)
        await asyncio.sleep(3.0)

        # Scroll to metrics
        await smooth_scroll(page, 1400, 2100, duration=3.0)
        await smooth_move(page, 800, 450, 600, 500, duration=2.0)
        await asyncio.sleep(2.0)

        # Scroll back up to header
        await smooth_scroll(page, 2100, 0, duration=2.5)
        await wait_until_elapsed(start_time, 29.61)

        # =========================================================================
        # SCENE 2: Multi-Wallet Authentication & EIP-6963 Isolation (29.61s - 55.81s)
        # =========================================================================
        print("--- SCENE 2: Multi-Wallet Authentication ---")
        # Glide to connect wallet button
        btn_box = await page.locator('#connect-wallet-btn').bounding_box()
        if btn_box:
            await smooth_move(page, 600, 100, btn_box['x'] + btn_box['width']/2, btn_box['y'] + btn_box['height']/2, duration=2.0)
            await asyncio.sleep(0.5)
            await page.click('#connect-wallet-btn')

        await page.wait_for_selector('.wallet-dialog', state='visible')
        await asyncio.sleep(1.5)

        # Hover over MetaMask
        mm_box = await page.locator('button.wallet-option-item[data-id="metamask"]').bounding_box()
        if mm_box:
            await smooth_move(page, 960, 300, mm_box['x'] + mm_box['width']/2, mm_box['y'] + mm_box['height']/2, duration=2.5)
            await asyncio.sleep(1.5)

        # Hover over OKX
        okx_box = await page.locator('button.wallet-option-item[data-id="okx"]').bounding_box()
        if okx_box:
            await smooth_move(page, mm_box['x'] + mm_box['width']/2, mm_box['y'] + mm_box['height']/2, okx_box['x'] + okx_box['width']/2, okx_box['y'] + okx_box['height']/2, duration=2.0)
            await asyncio.sleep(1.5)

        # Move to Anvil Signer and click
        anvil_box = await page.locator('button.wallet-option-item[data-id="anvil"]').bounding_box()
        if anvil_box:
            await smooth_move(page, okx_box['x'] + okx_box['width']/2, okx_box['y'] + okx_box['height']/2, anvil_box['x'] + anvil_box['width']/2, anvil_box['y'] + anvil_box['height']/2, duration=2.0)
            await asyncio.sleep(0.8)
            await page.click('button.wallet-option-item[data-id="anvil"]')

        # Verify connected state in header
        await page.wait_for_selector('#acc-sum-btn', state='visible')
        sum_box = await page.locator('#acc-sum-btn').bounding_box()
        if sum_box:
            await smooth_move(page, anvil_box['x'], anvil_box['y'], sum_box['x'] + sum_box['width']/2, sum_box['y'] + sum_box['height']/2, duration=2.0)

        await wait_until_elapsed(start_time, 55.81)

        # =========================================================================
        # SCENE 3: Guardian Console & Policy Registry Enrollment (55.81s - 86.09s)
        # =========================================================================
        print("--- SCENE 3: Guardian Console & Enrollment ---")
        await page.goto('http://127.0.0.1:3000/guardian')
        await asyncio.sleep(1.5)

        # Click EUR policy chip
        eur_btn = await page.locator('button.chip[data-c="EUR"]').bounding_box()
        if eur_btn:
            await smooth_move(page, 960, 200, eur_btn['x'] + eur_btn['width']/2, eur_btn['y'] + eur_btn['height']/2, duration=2.0)
            await page.click('button.chip[data-c="EUR"]')
            await asyncio.sleep(2.0)

        # Click CPP (COPPA) policy chip
        cpp_btn = await page.locator('button.chip[data-c="CPP"]').bounding_box()
        if cpp_btn:
            await smooth_move(page, eur_btn['x'], eur_btn['y'], cpp_btn['x'] + cpp_btn['width']/2, cpp_btn['y'] + cpp_btn['height']/2, duration=1.8)
            await page.click('button.chip[data-c="CPP"]')
            await asyncio.sleep(2.0)

        # Inspect policy parameters
        await smooth_scroll(page, 0, 350, duration=1.5)
        await asyncio.sleep(1.0)

        # Enroll on chain
        enroll_box = await page.locator('#enroll').bounding_box()
        if enroll_box:
            await smooth_move(page, 500, 400, enroll_box['x'] + enroll_box['width']/2, enroll_box['y'] + enroll_box['height']/2, duration=1.8)
            await page.click('#enroll')

        # Wait for on-chain confirmation
        await page.wait_for_selector('#enrollOut a.explorer-hash', timeout=12000)
        print("Enrollment tx confirmed on chain!")
        await smooth_move(page, enroll_box['x'], enroll_box['y'], 450, 680, duration=2.0)

        await wait_until_elapsed(start_time, 86.09)

        # =========================================================================
        # SCENE 4: Client-Side Encrypted Memory Vault (86.09s - 110.92s)
        # =========================================================================
        print("--- SCENE 4: Client-Side Encrypted Vault ---")
        await smooth_scroll(page, 350, 750, duration=2.0)

        # Passphrase
        pass_box = await page.locator('#passphrase').bounding_box()
        if pass_box:
            await smooth_move(page, 450, 680, pass_box['x'] + 50, pass_box['y'] + pass_box['height']/2, duration=1.5)
            await page.click('#passphrase')
            await page.type('#passphrase', 'GuardianMasterKey#2026', delay=35)

        # Memory text
        mem_box = await page.locator('#memText').bounding_box()
        if mem_box:
            await smooth_move(page, pass_box['x'], pass_box['y'], mem_box['x'] + 50, mem_box['y'] + mem_box['height']/2, duration=1.2)
            await page.click('#memText')
            await page.type('#memText', 'Classroom voice assistant logs, biometric session telemetry, and behavioral interaction profile', delay=25)

        # Click Seal Encrypted Memory
        add_btn = await page.locator('#addMemory').bounding_box()
        if add_btn:
            await smooth_move(page, mem_box['x'], mem_box['y'], add_btn['x'] + add_btn['width']/2, add_btn['y'] + add_btn['height']/2, duration=1.5)
            await page.click('#addMemory')

        # Wait for on-chain commitment
        await page.wait_for_selector('#memOut .status-good', timeout=12000)
        print("Memory commitment confirmed on chain!")
        await asyncio.sleep(2.0)

        await wait_until_elapsed(start_time, 110.92)

        # =========================================================================
        # SCENE 5: Statutory Erasure Request & Cryptographic Shredding (110.92s - 133.42s)
        # =========================================================================
        print("--- SCENE 5: Statutory Erasure Request ---")
        await smooth_scroll(page, 750, 1200, duration=2.0)

        # Scope selector
        scope_box = await page.locator('#scopeSel').bounding_box()
        if scope_box:
            await smooth_move(page, 600, 500, scope_box['x'] + 100, scope_box['y'] + scope_box['height']/2, duration=1.8)
            await asyncio.sleep(1.0)

        # Request Erase button
        req_box = await page.locator('#requestErase').bounding_box()
        if req_box:
            await smooth_move(page, scope_box['x'], scope_box['y'], req_box['x'] + req_box['width']/2, req_box['y'] + req_box['height']/2, duration=1.8)
            await asyncio.sleep(0.5)
            await page.click('#requestErase')

        # Wait for on-chain erasure request confirmation
        await page.wait_for_selector('#reqOut .status-good', timeout=12000)
        print("Erasure requested & key shredded!")
        await smooth_move(page, req_box['x'], req_box['y'], 500, 680, duration=2.0)

        await wait_until_elapsed(start_time, 133.42)

        # =========================================================================
        # SCENE 6: Dual-Notary Consensus & On-Chain Sealing (133.42s - 155.87s)
        # =========================================================================
        print("--- SCENE 6: Notary Engine & Sealing ---")
        await page.goto('http://127.0.0.1:3000/seal')
        await asyncio.sleep(2.0)

        # Show pending / attested queue
        await smooth_move(page, 500, 300, 750, 400, duration=2.0)
        await asyncio.sleep(2.0)

        # Check if there is a "Seal on Chain →" button available
        seal_btn = await page.locator('button:has-text("Seal on Chain →")').first.is_visible()
        if seal_btn:
            sbtn_box = await page.locator('button:has-text("Seal on Chain →")').first.bounding_box()
            if sbtn_box:
                await smooth_move(page, 750, 400, sbtn_box['x'] + sbtn_box['width']/2, sbtn_box['y'] + sbtn_box['height']/2, duration=2.0)
                await page.locator('button:has-text("Seal on Chain →")').first.click()
                await asyncio.sleep(3.0)

        # Scroll to confirmed receipts
        await smooth_scroll(page, 0, 450, duration=2.0)
        await smooth_move(page, 750, 500, 850, 600, duration=2.0)

        await wait_until_elapsed(start_time, 155.87)

        # =========================================================================
        # SCENE 7: Court-Admissible DEC v2, Verifier & Explorer (155.87s - 180.00s)
        # =========================================================================
        print("--- SCENE 7: DEC Certificate & Verifier ---")
        # Fetch the latest DEC hash from API
        q_data = await (await page.request.get('http://127.0.0.1:3000/api/notary/queue')).json()
        dec_ops = [o for o in (q_data.get('ops') or []) if o.get('decHash')]
        latest_dec = dec_ops[0]['decHash'] if dec_ops else '0x9708b380a89aabb9b5cb30198764bbd297b1ac337a6d37cd5bfded29a7d6c0bc'

        # Navigate to DEC Certificate
        await page.goto(f'http://127.0.0.1:3000/cert/{latest_dec}')
        await asyncio.sleep(2.0)
        await smooth_scroll(page, 0, 300, duration=2.0)
        await smooth_move(page, 600, 350, 900, 450, duration=2.0)

        # Navigate to Verifier
        await page.goto('http://127.0.0.1:3000/verify')
        await asyncio.sleep(1.0)
        await page.wait_for_selector('#pick', state='visible')
        await page.select_option('#pick', latest_dec)
        await asyncio.sleep(0.5)

        v_box = await page.locator('#verify').bounding_box()
        if v_box:
            await smooth_move(page, 500, 300, v_box['x'] + v_box['width']/2, v_box['y'] + v_box['height']/2, duration=1.5)
            await page.click('#verify')
            await page.wait_for_selector('#out .badge.ok', timeout=6000)

        await asyncio.sleep(1.5)

        # Quick view of Explorer
        await page.goto('http://127.0.0.1:3000/explorer')
        await asyncio.sleep(1.5)
        await smooth_scroll(page, 0, 350, duration=1.5)

        # Wait until exactly 180.00 seconds!
        await wait_until_elapsed(start_time, 180.00)
        print(f"[{time.strftime('%X')}] 180 seconds video recording complete!")

        await context.close()
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
