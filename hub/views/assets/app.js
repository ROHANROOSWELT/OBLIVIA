// Oblivia hub — shared frontend helper (fetched pages, ethers v6 UMD global).
window.OBLIVIA = (function () {
  const H = {};

  // Dynamic API Base Resolution:
  // - Defaults to relative URL (same-origin / Vercel rewrite proxy)
  // - If window.__OBLIVIA_API_BASE__ or localStorage('oblivia_api_base') is set, prepends it
  H.apiBase = (function () {
    if (typeof window === 'undefined') return '';
    if (window.__OBLIVIA_API_BASE__) return window.__OBLIVIA_API_BASE__.replace(/\/+$/, '');
    try {
      const stored = localStorage.getItem('oblivia_api_base');
      if (stored) return stored.replace(/\/+$/, '');
    } catch (e) {}
    return '';
  })();

  H.url = (path) => {
    if (/^https?:\/\//i.test(path)) return path;
    const base = H.apiBase || '';
    if (!path.startsWith('/')) path = '/' + path;
    return base ? `${base}${path}` : path;
  };

  H.get = async (url) => {
    const fullUrl = H.url(url);
    const r = await fetch(fullUrl, {
      headers: { 'accept': 'application/json' },
    });
    return r.json();
  };
  H.post = async (url, body) => {
    const fullUrl = H.url(url);
    const r = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return r.json();
  };

  H.short = (x, n) => !x ? '' : String(x).slice(0, n || 10) + '…' + String(x).slice(-6);

  H.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------- wallet discovery & EIP-6963 */
  const _eip6963Map = new Map();
  if (typeof window !== 'undefined') {
    window.addEventListener('eip6963:announceProvider', (event) => {
      if (event?.detail?.info?.uuid) {
        _eip6963Map.set(event.detail.info.uuid, event.detail);
        if (event.detail.info.rdns) {
          _eip6963Map.set(event.detail.info.rdns, event.detail);
        }
      }
    });
    try {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch (e) {}
  }

  /* ------------------------------------------------------------- wallet state */
  H.provider = null;
  H.signer = null;
  H.account = null;
  H.walletType = null;
  H.walletName = null;

  let _registry = null;
  let _policy = null;

  const WALLET_LOGOS = {
    metamask: `<svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <path d="M29.5 4.5L16.5 14L18.5 8.5L29.5 4.5Z" fill="#E2761B"/>
      <path d="M2.5 4.5L13.5 8.5L15.5 14L2.5 4.5Z" fill="#E4761B"/>
      <path d="M25.5 22L22.5 26.5L28.5 28.5L30.5 22.5L25.5 22Z" fill="#E4761B"/>
      <path d="M1.5 22.5L3.5 28.5L9.5 26.5L6.5 22L1.5 22.5Z" fill="#E4761B"/>
      <path d="M9 14.5L7.5 17L13.5 17.5L13.5 11L9 14.5Z" fill="#E4761B"/>
      <path d="M23 14.5L18.5 11L18.5 17.5L24.5 17L23 14.5Z" fill="#E4761B"/>
      <path d="M9.5 26.5L13 24.5L10 22.5L9.5 26.5Z" fill="#E4761B"/>
      <path d="M19 24.5L22.5 26.5L22 22.5L19 24.5Z" fill="#E4761B"/>
      <path d="M22.5 26.5L19 24.5L19.5 27L19.5 28L22.5 26.5Z" fill="#D7C1B3"/>
      <path d="M9.5 26.5L12.5 28L12.5 27L13 24.5L9.5 26.5Z" fill="#D7C1B3"/>
      <path d="M13 20.5L10 19.5L12 18.5L13 20.5Z" fill="#233447"/>
      <path d="M19 20.5L20 18.5L22 19.5L19 20.5Z" fill="#233447"/>
      <path d="M9.5 26.5L6.5 22L10 22.5L9.5 26.5Z" fill="#CD6116"/>
      <path d="M22 22.5L25.5 22L22.5 26.5L22 22.5Z" fill="#CD6116"/>
      <path d="M24.5 17L18.5 17.5L19 20.5L20 18.5L22 19.5L25.5 22L26.5 17.5L24.5 17Z" fill="#CD6116"/>
      <path d="M7.5 17L5.5 17.5L6.5 22L10 19.5L12 18.5L13 20.5L13.5 17.5L7.5 17Z" fill="#CD6116"/>
      <path d="M16 17.5L13.5 17.5L13 20.5L14 24.5L14 17.5L16 17.5Z" fill="#E4751F"/>
      <path d="M16 17.5L18.5 17.5L19 20.5L18 24.5L18 17.5L16 17.5Z" fill="#E4751F"/>
      <path d="M18.5 17.5L18 24.5L19 24.5L22 22.5L22 19.5L19 20.5L18.5 17.5Z" fill="#F6851B"/>
      <path d="M10 19.5L10 22.5L13 24.5L14 24.5L13 20.5L13.5 17.5L10 19.5Z" fill="#F6851B"/>
    </svg>`,
    okx: `<svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#000000"/>
      <rect x="7" y="7" width="5.5" height="5.5" fill="#FFFFFF"/>
      <rect x="19.5" y="7" width="5.5" height="5.5" fill="#FFFFFF"/>
      <rect x="13.25" y="13.25" width="5.5" height="5.5" fill="#FFFFFF"/>
      <rect x="7" y="19.5" width="5.5" height="5.5" fill="#FFFFFF"/>
      <rect x="19.5" y="19.5" width="5.5" height="5.5" fill="#FFFFFF"/>
    </svg>`,
    injected: `<svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#2456E6"/>
      <path d="M16 5L15.8 5.7V20.2L16 20.4L22.5 16.5L16 5Z" fill="#FFFFFF" fill-opacity="0.8"/>
      <path d="M16 5L9.5 16.5L16 20.4V5Z" fill="#FFFFFF"/>
      <path d="M16 21.6L15.9 21.7V27L16 27.3L22.5 17.7L16 21.6Z" fill="#FFFFFF" fill-opacity="0.8"/>
      <path d="M16 27.3V21.6L9.5 17.7L16 27.3Z" fill="#FFFFFF"/>
    </svg>`,
    anvil: `<svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#1C241E"/>
      <path d="M16 6L10 16H15L13 25L22 14H17L20 6H16Z" fill="#C9F36B"/>
    </svg>`,
  };

  H.detectWallets = function () {
    const wallets = [];

    // 1. MetaMask
    let mmProvider = null;
    for (const [key, detail] of _eip6963Map.entries()) {
      if (key.includes('metamask') || (detail.info?.name && detail.info.name.toLowerCase().includes('metamask'))) {
        mmProvider = detail.provider;
        break;
      }
    }
    if (!mmProvider && typeof window !== 'undefined' && window.ethereum) {
      if (Array.isArray(window.ethereum.providers)) {
        mmProvider = window.ethereum.providers.find((p) => p.isMetaMask && !p.isOkxWallet);
      } else if (window.ethereum.isMetaMask && !window.ethereum.isOkxWallet) {
        mmProvider = window.ethereum;
      }
    }

    wallets.push({
      id: 'metamask',
      name: 'MetaMask',
      rdns: 'io.metamask',
      desc: 'Browser extension signer',
      detected: Boolean(mmProvider),
      provider: mmProvider,
      installUrl: 'https://metamask.io/download/',
      iconKey: 'metamask',
    });

    // 2. OKX Wallet
    let okxProvider = null;
    for (const [key, detail] of _eip6963Map.entries()) {
      if (key.includes('okx') || (detail.info?.name && detail.info.name.toLowerCase().includes('okx'))) {
        okxProvider = detail.provider;
        break;
      }
    }
    if (!okxProvider && typeof window !== 'undefined') {
      if (window.okxwallet) {
        okxProvider = window.okxwallet.ethereum || window.okxwallet;
      } else if (window.ethereum) {
        if (Array.isArray(window.ethereum.providers)) {
          okxProvider = window.ethereum.providers.find((p) => p.isOkxWallet);
        } else if (window.ethereum.isOkxWallet) {
          okxProvider = window.ethereum;
        }
      }
    }

    wallets.push({
      id: 'okx',
      name: 'OKX Wallet',
      rdns: 'com.okx.wallet',
      desc: 'Multi-chain Web3 wallet',
      detected: Boolean(okxProvider),
      provider: okxProvider,
      installUrl: 'https://www.okx.com/web3',
      iconKey: 'okx',
    });

    // 3. Other EIP-6963 providers (Coinbase, Rabby, etc.)
    for (const [key, detail] of _eip6963Map.entries()) {
      const rdns = detail.info?.rdns || '';
      if (rdns === 'io.metamask' || rdns === 'com.okx.wallet') continue;
      if (wallets.some((w) => w.id === detail.info.uuid || w.rdns === rdns)) continue;
      wallets.push({
        id: detail.info.uuid,
        name: detail.info.name,
        rdns: rdns,
        desc: `Injected provider (${rdns || 'EIP-6963'})`,
        detected: true,
        provider: detail.provider,
        iconUrl: detail.info.icon,
        iconKey: 'injected',
      });
    }

    // 4. Generic Injected fallback
    if (typeof window !== 'undefined' && window.ethereum && !wallets.some((w) => w.detected && w.provider === window.ethereum)) {
      wallets.push({
        id: 'injected',
        name: 'Browser Injected',
        rdns: 'window.ethereum',
        desc: 'Default window.ethereum provider',
        detected: true,
        provider: window.ethereum,
        iconKey: 'injected',
      });
    }

    // 5. Local Anvil Test Signer
    wallets.push({
      id: 'anvil',
      name: 'Local Anvil Test Signer',
      rdns: 'local.anvil',
      desc: '0xf39F…2266 · 10,000 ETH · Instant demo',
      detected: true,
      provider: null,
      iconKey: 'anvil',
    });

    return wallets;
  };

  H.notifyWalletUpdated = function () {
    window.dispatchEvent(
      new CustomEvent('oblivia:walletConnected', {
        detail: {
          account: H.account,
          walletName: H.walletName,
          walletType: H.walletType,
        },
      }),
    );
    if (typeof H.updateHeaderWallet === 'function') {
      H.updateHeaderWallet();
    }
  };

  H.disconnectWallet = function () {
    H.provider = null;
    H.signer = null;
    H.account = null;
    H.walletType = null;
    H.walletName = null;
    _registry = null;
    _policy = null;
    try {
      localStorage.removeItem('oblivia_preferred_wallet');
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('oblivia:walletDisconnected'));
    if (typeof H.updateHeaderWallet === 'function') {
      H.updateHeaderWallet();
    }
  };

  H.selectWallet = async function (walletId) {
    const wallets = H.detectWallets();
    const target = wallets.find((w) => w.id === walletId);
    if (!target) throw new Error('Unknown wallet selection: ' + walletId);

    if (target.id === 'anvil') {
      const rpcUrl = 'http://127.0.0.1:8545';
      const bp = new ethers.JsonRpcProvider(rpcUrl);
      const devKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const signer = new ethers.Wallet(devKey, bp);
      const address = await signer.getAddress();

      H.provider = bp;
      H.signer = signer;
      H.account = address;
      H.walletType = 'anvil';
      H.walletName = 'Local Anvil #0';
      _registry = null;
      _policy = null;
      try {
        localStorage.setItem('oblivia_preferred_wallet', 'anvil');
      } catch (e) {}
      H.notifyWalletUpdated();
      return address;
    }

    if (!target.detected || !target.provider) {
      if (target.installUrl) {
        window.open(target.installUrl, '_blank', 'noopener,noreferrer');
        throw new Error(`${target.name} extension is not detected in this browser. Opened download page.`);
      }
      throw new Error(`${target.name} is not detected in this browser.`);
    }

    const raw = target.provider;
    await raw.request({ method: 'eth_requestAccounts' });

    try {
      const chainIdHex = await raw.request({ method: 'eth_chainId' });
      if (chainIdHex !== '0x7a69' && chainIdHex !== '0x14a34') {
        try {
          await raw.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x7a69' }],
          });
        } catch (switchError) {
          if (switchError.code === 4902 || /unrecognized/i.test(switchError.message || '')) {
            try {
              await raw.request({
                method: 'wallet_addEthereumChain',
                params: [
                  {
                    chainId: '0x7a69',
                    chainName: 'Anvil Localhost',
                    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                    rpcUrls: ['http://127.0.0.1:8545'],
                  },
                ],
              });
            } catch (addError) {}
          }
        }
      }
    } catch (e) {}

    const bp = new ethers.BrowserProvider(raw);
    const signer = await bp.getSigner();
    const address = await signer.getAddress();

    H.provider = bp;
    H.signer = signer;
    H.account = address;
    H.walletType = target.id;
    H.walletName = target.name;
    _registry = null;
    _policy = null;
    try {
      localStorage.setItem('oblivia_preferred_wallet', target.id);
    } catch (e) {}
    H.notifyWalletUpdated();
    return address;
  };

  /* ------------------------------------------------------------- slide down chooser */
  let _chooserResolver = null;
  let _chooserRejecter = null;

  H.openWalletChooser = function () {
    return new Promise((resolve, reject) => {
      _chooserResolver = resolve;
      _chooserRejecter = reject;

      let backdrop = document.getElementById('wallet-modal-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'wallet-modal-backdrop';
        backdrop.className = 'wallet-dialog-backdrop';
        backdrop.innerHTML = `
          <section class="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
            <header>
              <div>
                <span>Injected EVM wallet</span>
                <h2 id="wallet-dialog-title">Choose wallet</h2>
              </div>
              <button type="button" id="wallet-modal-close" aria-label="Close wallet chooser">
                ${H.icon('x', 18)}
              </button>
            </header>
            <p>Select your preferred wallet for signing right-to-erasure transactions.</p>
            <div id="wallet-modal-error" class="wallet-dialog-error" style="display:none; margin-bottom:12px;"></div>
            <div class="wallet-options" id="wallet-options-list"></div>
            <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--rule); display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; color:var(--muted);">Saved preference: <strong id="wallet-current-pref">None</strong></span>
              <button type="button" id="wallet-clear-pref" style="background:none; border:none; color:var(--blue); font-size:12px; font-weight:700; cursor:pointer;">Reset</button>
            </div>
          </section>
        `;
        document.body.appendChild(backdrop);

        backdrop.addEventListener('mousedown', (e) => {
          if (e.target === backdrop) H.closeWalletChooser();
        });
        document.getElementById('wallet-modal-close').onclick = () => H.closeWalletChooser();
        document.getElementById('wallet-clear-pref').onclick = () => {
          try {
            localStorage.removeItem('oblivia_preferred_wallet');
          } catch (e) {}
          H.renderChooserOptions();
        };
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && backdrop.style.display !== 'none') {
            H.closeWalletChooser();
          }
        });
      }

      backdrop.style.display = 'grid';
      const errBox = document.getElementById('wallet-modal-error');
      if (errBox) errBox.style.display = 'none';
      H.renderChooserOptions();
    });
  };

  H.closeWalletChooser = function () {
    const backdrop = document.getElementById('wallet-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    if (_chooserRejecter) {
      _chooserRejecter(new Error('User cancelled wallet connection'));
      _chooserRejecter = null;
      _chooserResolver = null;
    }
  };

  H.renderChooserOptions = function () {
    const container = document.getElementById('wallet-options-list');
    const prefLabel = document.getElementById('wallet-current-pref');
    if (!container) return;

    let savedPref = null;
    try {
      savedPref = localStorage.getItem('oblivia_preferred_wallet');
    } catch (e) {}

    const wallets = H.detectWallets();
    const prefWallet = wallets.find((w) => w.id === savedPref);
    if (prefLabel) {
      prefLabel.textContent = prefWallet ? prefWallet.name : 'None';
    }

    container.innerHTML = wallets
      .map((w) => {
        const isPref = savedPref === w.id;
        const iconHtml = w.iconUrl
          ? `<img src="${w.iconUrl}" alt="${w.name}" style="width:28px;height:28px;border-radius:4px;" />`
          : (WALLET_LOGOS[w.iconKey] || H.icon('wallet', 20));

        let tagHtml = '';
        if (w.id === 'anvil') {
          tagHtml = '<span class="badge ok">10,000 ETH · Instant</span>';
        } else if (w.detected) {
          tagHtml = isPref ? '<span class="badge ok">Preferred</span>' : '<span class="badge ok">Detected</span>';
        } else {
          tagHtml = '<span class="badge warn">Install ↗</span>';
        }

        return `
          <button type="button" class="wallet-option-item ${isPref ? 'active-preference' : ''}" data-id="${w.id}">
            <span class="wallet-option-icon-box" style="display:grid;place-items:center;width:32px;height:32px;">
              ${iconHtml}
            </span>
            <span class="wallet-option-body">
              <div>
                <strong>${H.esc(w.name)}</strong>
                ${tagHtml}
              </div>
              <small>${H.esc(w.desc)}</small>
            </span>
            ${H.icon('arrow-right', 14)}
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('button.wallet-option-item').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        const errBox = document.getElementById('wallet-modal-error');
        if (errBox) errBox.style.display = 'none';

        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span style="grid-column: 1 / -1; text-align:center; color:var(--blue); font-weight:700;">Connecting to ${H.esc(id)}…</span>`;

        try {
          const addr = await H.selectWallet(id);
          const backdrop = document.getElementById('wallet-modal-backdrop');
          if (backdrop) backdrop.style.display = 'none';
          if (_chooserResolver) {
            _chooserResolver(addr);
            _chooserResolver = null;
            _chooserRejecter = null;
          }
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = originalText;
          if (errBox) {
            errBox.textContent = err.message || String(err);
            errBox.style.display = 'block';
          }
        }
      };
    });
  };

  /* ------------------------------------------------------------- main connect entry */
  H.connectWallet = async function (explicitId) {
    if (explicitId) {
      return H.selectWallet(explicitId);
    }
    if (H.account) {
      return H.account;
    }
    return H.openWalletChooser();
  };

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

      const updateWalletSlot = () => {
        const slot = document.getElementById('wallet-slot');
        if (!slot) return;

        if (!H.account) {
          slot.innerHTML = `<button id="connect-wallet-btn" class="button button-dark button-small wallet-connect" type="button">${H.icon('wallet', 15)} Connect wallet</button>`;
          const btn = document.getElementById('connect-wallet-btn');
          if (btn) btn.onclick = () => H.openWalletChooser().catch(() => {});
        } else {
          slot.innerHTML = `
            <div class="account-control" style="position:relative;">
              <button class="account-summary" type="button" id="acc-sum-btn" aria-expanded="false" aria-controls="account-menu">
                <span>${H.esc(H.walletName || 'Connected')}</span>
                <strong>${H.short(H.account, 6)}</strong>
                ${H.icon('chevron-down', 13)}
              </button>
              <div id="account-menu" class="account-menu" style="display:none;">
                <span>Connected account</span>
                <code>${H.esc(H.account)}</code>
                <div class="status-dot status-live" style="margin-bottom:12px;">${H.esc(H.walletName || 'Wallet')} · Local Anvil #31337</div>
                <button type="button" id="acc-copy-btn">Copy address</button>
                <button type="button" id="acc-switch-btn">Switch wallet</button>
                <button type="button" id="acc-disconnect-btn" class="btn-danger">Disconnect</button>
              </div>
            </div>
          `;

          const sumBtn = document.getElementById('acc-sum-btn');
          const menu = document.getElementById('account-menu');
          const copyBtn = document.getElementById('acc-copy-btn');
          const switchBtn = document.getElementById('acc-switch-btn');
          const discoBtn = document.getElementById('acc-disconnect-btn');

          if (sumBtn && menu) {
            sumBtn.onclick = (e) => {
              e.stopPropagation();
              const isOpen = menu.style.display !== 'none';
              menu.style.display = isOpen ? 'none' : 'block';
              sumBtn.setAttribute('aria-expanded', String(!isOpen));
            };
          }

          if (copyBtn) {
            copyBtn.onclick = () => {
              if (H.account) {
                navigator.clipboard.writeText(H.account);
                copyBtn.textContent = 'Copied to clipboard!';
                setTimeout(() => { copyBtn.textContent = 'Copy address'; }, 1800);
              }
            };
          }

          if (switchBtn) {
            switchBtn.onclick = () => {
              if (menu) menu.style.display = 'none';
              H.openWalletChooser().catch(() => {});
            };
          }

          if (discoBtn) {
            discoBtn.onclick = () => {
              if (menu) menu.style.display = 'none';
              H.disconnectWallet();
            };
          }

          document.addEventListener('click', (e) => {
            if (menu && menu.style.display !== 'none' && !e.target.closest('.account-control')) {
              menu.style.display = 'none';
              if (sumBtn) sumBtn.setAttribute('aria-expanded', 'false');
            }
          });
        }
      };

      H.updateHeaderWallet = updateWalletSlot;

      // Silent reconnection on boot (NO popups)
      let pref = null;
      try { pref = localStorage.getItem('oblivia_preferred_wallet'); } catch (e) {}

      if (H.account) {
        updateWalletSlot();
      } else if (pref === 'anvil') {
        H.selectWallet('anvil').catch(() => updateWalletSlot());
      } else if (pref) {
        const wallets = H.detectWallets();
        const target = wallets.find((w) => w.id === pref && w.detected && w.provider);
        if (target && target.provider && typeof target.provider.request === 'function') {
          target.provider
            .request({ method: 'eth_accounts' })
            .then((accounts) => {
              if (accounts && accounts.length > 0) {
                H.selectWallet(target.id).catch(() => updateWalletSlot());
              } else {
                updateWalletSlot();
              }
            })
            .catch(() => updateWalletSlot());
        } else {
          updateWalletSlot();
        }
      } else {
        updateWalletSlot();
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
