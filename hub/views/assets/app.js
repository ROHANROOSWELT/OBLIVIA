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

  return H;
})();
