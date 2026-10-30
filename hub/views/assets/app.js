// Oblivia hub — shared frontend helper (fetched pages, ethers v6 UMD global).
window.OBLIVIA = (function () {
  const H = {};

  H.get = async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    return r.json();
  };
  H.post = async (url, body) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    });
    return r.json();
  };

  H.short = (x, n) => !x ? '' : String(x).slice(0, n || 10) + '…' + String(x).slice(-6);

  H.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------- wallet */
  H.provider = null;
  H.signer = null;
  H.account = null;

  H.connectWallet = async function () {
    if (!window.ethereum) throw new Error('No browser wallet (MetaMask etc.) detected');
    H.provider = new ethers.BrowserProvider(window.ethereum);
    H.signer = await H.provider.getSigner();
    H.account = await H.signer.getAddress();
    return H.account;
  };

  let _registry = null;
  let _policy = null;

  H.registry = async function () {
    const st = await H.get('/api/chain/status');
    if (!st.deploy) throw new Error('Not deployed yet — run scripts/run-local.sh');
    if (!_registry) {
      const abi = await (await fetch('/assets/eraseregistry-abi.json')).json();
      H.registry_address = st.deploy.EraseRegistry;
      _registry = new ethers.Contract(st.deploy.EraseRegistry, abi, H.signer);
      H.registryRead = new ethers.Contract(st.deploy.EraseRegistry, abi, H.provider);
    }
    return _registry;
  };
  H.policy = async function () {
    if (!_policy) {
      const st = await (await H.get('/api/chain/status'));
      if (!st.deploy) throw new Error('Not deployed yet');
      const abi = await (await fetch('/assets/policyregistry-abi.json')).json();
      _policy = new ethers.Contract(st.deploy.PolicyRegistry, abi, H.signer);
    }
    return _policy;
  };

  /*---------------------------------------------- guardian crypto (AES-GCM) */
  H.deriveKey = function () { /* kept for reference; encryption derives inline */ return null; };
  function hexToBufer(hex) {
    const b = new Uint8Array((hex.replace(/^0x/, '').length || 2) / 2);
    const s = hex.replace(/^0x/, '');
    for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(i * 2, i * 2 + 2) || '0', 16);
    return b;
  }
  function bufHex(buf) {
    return '0x' + [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function buferHex(hex) {
    return Uint8Array.from(hex.replace(/^0x/, '').match(/.{2}/g || []).map((h) => parseInt(h, 16)));
  }

  // Encrypts with a browser-held key; hub only ever sees iv/tag/body hex.
  H.encryptMemory = async function (passphrase, plaintext) {
    const salt = ethers.randomBytes(16);
    const iv = ethers.randomBytes(12);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const whole = new Uint8Array(ct); // GCM: 16-byte tag at the end
    const tag = whole.slice(whole.length - 16);
    const body = whole.slice(0, whole.length - 16);
    return { salt: bufHex(salt), iv: bufHex(iv), tag: bufHex(tag), cipher: bufHex(body) };
  };

  H.decryptMemory = async function (passphrase, { salt, iv, tag, cipher }) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: buferHex(salt), iterations: 150000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt', 'encrypt'],
    );
    const whole = new Uint8Array([...buferHex(cipher), ...buferHex(tag)]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buferHex(iv) }, key, whole);
    return new TextDecoder().decode(pt);
  };

  /*-------------------------------------------------------------- age bands */
  H.AGE_BANDS = { 0: '0-5', 1: '6-12', 2: '13-17', 3: '18+' };
  H.bandName = (b) => H.AGE_BANDS[b] ?? String(b);

  H.statusBadge = (stage) => {
    const map = {
      AWAIT_GUARDIAN_TX: ['warn', 'awaiting guardian txn'],
      QUEUED: ['info', 'queued for notary'],
      ATTESTED: ['info', 'notarized (ATTESTOR)'],
      DON_SENT: ['info', 'report sent (DON)'],
      CONFIRMED: ['ok', 'confirmed on chain'],
    };
    const [cls, label] = map[stage] ?? ['bad', stage];
    return `<span class="badge ${cls}">${label}</span>`;
  };

  /*------------------------------------------------------------- FirmDepth Icons & Shell */
  const ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
    'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  H.icon = (name, size = 16, className = '') => {
    const body = ICONS[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}">${body}</svg>`;
  };

  H.renderShell = function (currentRoute = '/') {
    const navItems = [
      ['/', 'Overview'],
      ['/guardian', 'Guardian'],
      ['/explorer', 'Explorer'],
      ['/verify', 'Verify'],
      ['/seal', 'Notary Queue'],
      ['/docs', 'Docs'],
    ];

    const header = document.querySelector('header.site-header') || document.querySelector('header.topbar');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = `
        <a class="wordmark" href="/" aria-label="OBLIVIA home"><span>O</span>OBLIVIA</a>
        <button id="menu-btn" class="menu-button" type="button" aria-label="Toggle navigation">${H.icon('menu', 20)}</button>
        <nav id="site-nav">
          ${navItems.map(([href, label]) => `<a href="${href}" ${currentRoute === href ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <div class="header-actions">
          <div id="wallet-slot">
            <button id="connect-wallet-btn" class="button button-dark button-small wallet-connect" type="button">
              ${H.icon('wallet', 15)} Connect wallet
            </button>
          </div>
        </div>
      `;

      const menuBtn = document.getElementById('menu-btn');
      const siteNav = document.getElementById('site-nav');
      if (menuBtn && siteNav) {
        menuBtn.onclick = () => {
          siteNav.classList.toggle('open');
          menuBtn.innerHTML = siteNav.classList.contains('open') ? H.icon('x', 20) : H.icon('menu', 20);
        };
      }

      const updateWalletSlot = (addr, netName = 'Local') => {
        const slot = document.getElementById('wallet-slot');
        if (!slot) return;
        if (!addr) {
          slot.innerHTML = `<button id="connect-wallet-btn" class="button button-dark button-small wallet-connect" type="button">${H.icon('wallet', 15)} Connect wallet</button>`;
          document.getElementById('connect-wallet-btn').onclick = async () => {
            try {
              const a = await H.connectWallet();
              updateWalletSlot(a, 'Active');
            } catch (e) {
              alert(e.message || e);
            }
          };
        } else {
          slot.innerHTML = `
            <div class="account-control">
              <button class="account-summary" type="button" id="acc-sum-btn">
                <span>${netName}</span>
                <strong>${H.short(addr, 6)}</strong>
                ${H.icon('chevron-down', 13)}
              </button>
            </div>
          `;
        }
      };

      if (window.ethereum && window.ethereum.selectedAddress) {
        H.connectWallet().then((a) => updateWalletSlot(a, 'Connected')).catch(() => updateWalletSlot(null));
      } else {
        updateWalletSlot(null);
      }
    }

    const existingFooter = document.querySelector('footer.site-footer') || document.querySelector('.footer');
    if (existingFooter) {
      existingFooter.outerHTML = `
        <footer class="site-footer">
          <div>
            <a class="wordmark" href="/"><span>O</span>OBLIVIA</a>
            <p>Statute-bound verifiable right-to-erasure protocol for minors in immutable digital systems.</p>
          </div>
          <div class="footer-links">
            <a href="/guardian">Guardian</a>
            <a href="/explorer">Explorer</a>
            <a href="/verify">Verify</a>
            <a href="/seal">Notary Queue</a>
            <a href="/docs">Docs</a>
            <a href="https://dorahacks.io/hackathon/legal-hack-2026/detail" target="_blank" rel="noreferrer">BLI Legal Hackathon</a>
          </div>
          <p class="footer-meta">Zero PII on-chain · DEC v2 Evidence Engine · Base Sepolia · Dual-Notary (ATTESTOR &amp; Chainlink CRE DON)</p>
        </footer>
      `;
    }
  };

  return H;
})();
