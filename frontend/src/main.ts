// SPDX-License-Identifier: Apache-2.0
//
// Wires the DOM in index.html to the AuditClient sandbox and the wallet
// connector. Deliberately framework-free: this is a small, self-contained demo,
// not an app that needs a component library.
//
// Flow: connect a wallet -> it signs one message -> the employer key + payroll
// salt are derived from that signature (see identity.ts) -> "Run audit" deploys
// the contract, registers the employer, and submits one confidential audit over
// the payroll typed into the table (which never leaves the browser). Until a
// wallet is connected — or demo mode is chosen — the audit button is locked.

import {
  AuditClient,
  createEmployerPrivateState,
  type Ledger,
} from '@midnight-level4/pay-equity-contract';
import { describeError } from './errors.js';
import { shortHex, toHex } from './hex.js';
import { type EmployerIdentity, deriveIdentity, randomIdentity } from './identity.js';
import {
  type CategoryInput,
  activeCount,
  isPayrollCompliant,
  toContractCategory,
  verdictFor,
} from './payroll.js';
import { NETWORK_IDS, connectWallet, describeConnection, detectWallets } from './wallet.js';

const THRESHOLD = 5n;
const MAX_CATEGORIES = 6;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let audit: AuditClient | null = null;
/** Set once a wallet is connected (or demo mode chosen); null keeps the audit locked. */
let identity: EmployerIdentity | null = null;

/** The private payroll being edited — witnesses, never written to the ledger. */
let categories: CategoryInput[] = [
  { name: 'Engineering', manCount: 12, manAvg: 92000, womanCount: 8, womanAvg: 90000 },
  { name: 'Sales', manCount: 6, manAvg: 70000, womanCount: 9, womanAvg: 68000 },
  { name: 'Support', manCount: 4, manAvg: 55000, womanCount: 10, womanAvg: 54000 },
];

// ---------------------------------------------------------------- logging --

const logList = $<HTMLOListElement>('log-list');

const log = (message: string, ok: boolean): void => {
  const item = document.createElement('li');
  item.className = ok ? 'ok' : 'err';
  const time$ = document.createElement('span');
  time$.className = 'muted';
  time$.textContent = new Date().toLocaleTimeString();
  const msg$ = document.createElement('span');
  msg$.className = 'msg';
  msg$.textContent = `${ok ? '✓' : '✗'} ${message}`;
  item.append(time$, ' ', msg$);
  logList.prepend(item);
};

// --------------------------------------------------------------- payroll UI --

const rowsBody = $<HTMLTableSectionElement>('category-rows');

const numberInput = (value: number, onInput: (n: number) => void): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.value = String(value);
  input.addEventListener('input', () => {
    onInput(Number(input.value) || 0);
    renderPreview();
  });
  return input;
};

const renderRows = (): void => {
  rowsBody.innerHTML = '';
  categories.forEach((cat, i) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = cat.name;
    nameInput.className = 'cat-name';
    nameInput.addEventListener('input', () => {
      categories[i] = { ...categories[i], name: nameInput.value };
      renderPreview();
    });
    nameTd.append(nameInput);

    const cells: HTMLTableCellElement[] = [nameTd];
    const fields: (keyof CategoryInput)[] = ['manCount', 'manAvg', 'womanCount', 'womanAvg'];
    for (const field of fields) {
      const td = document.createElement('td');
      td.append(
        numberInput(cat[field] as number, (n) => {
          categories[i] = { ...categories[i], [field]: n };
        }),
      );
      cells.push(td);
    }

    const gapTd = document.createElement('td');
    gapTd.className = 'gap-cell';
    const v = verdictFor(cat, THRESHOLD);
    if (!v.comparable) {
      gapTd.innerHTML = '<span class="pill neutral">n/a</span>';
    } else {
      gapTd.innerHTML = `<span class="pill ${v.within ? 'ok' : 'over'}">${v.gapPercent}%</span>`;
    }
    cells.push(gapTd);

    const actionTd = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.className = 'link-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'remove category';
    removeBtn.addEventListener('click', () => {
      categories.splice(i, 1);
      renderRows();
      renderPreview();
    });
    actionTd.append(removeBtn);
    cells.push(actionTd);

    tr.append(...cells);
    rowsBody.append(tr);
  });
};

const renderPreview = (): void => {
  // Keep gap cells current without rebuilding inputs (which would lose focus).
  const gapCells = rowsBody.querySelectorAll('.gap-cell');
  categories.forEach((cat, i) => {
    const v = verdictFor(cat, THRESHOLD);
    const cell = gapCells[i];
    if (!cell) return;
    cell.innerHTML = !v.comparable
      ? '<span class="pill neutral">n/a</span>'
      : `<span class="pill ${v.within ? 'ok' : 'over'}">${v.gapPercent}%</span>`;
  });

  const compliant = isPayrollCompliant(categories, THRESHOLD);
  const over = categories.filter((c) => {
    const v = verdictFor(c, THRESHOLD);
    return v.comparable && !v.within;
  });
  const line = $('preview-line');
  line.className = `muted preview-line ${compliant ? 'ok' : 'over'}`;
  line.textContent = compliant
    ? `Local preview: COMPLIANT — every category within ${THRESHOLD}%. The proof will publish "compliant: true".`
    : `Local preview: NOT COMPLIANT — over ${THRESHOLD}% in: ${over.map((c) => c.name || 'unnamed').join(', ')}. The proof will publish "compliant: false".`;
};

$('add-category-btn').addEventListener('click', () => {
  if (categories.length >= MAX_CATEGORIES) {
    log(`At most ${MAX_CATEGORIES} categories are supported`, false);
    return;
  }
  categories.push({ name: 'New category', manCount: 0, manAvg: 0, womanCount: 0, womanAvg: 0 });
  renderRows();
  renderPreview();
});

// ------------------------------------------------------------------- lock --

const renderLock = (): void => {
  const unlocked = identity !== null;
  $<HTMLButtonElement>('run-audit-btn').disabled = !unlocked;
  $('gate-hint').hidden = unlocked;
};

const unlock = (next: EmployerIdentity): void => {
  identity = next;
  renderLock();
};

// ------------------------------------------------------------------ wallet --

const setWalletStatus = (message: string, isError = false): void => {
  const el = $('wallet-status');
  el.textContent = message;
  el.classList.toggle('err', isError);
};

const networkSelect = $<HTMLSelectElement>('network-select');
for (const id of NETWORK_IDS) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = id;
  networkSelect.append(option);
}

$('detect-wallet-btn').addEventListener('click', () => {
  const wallets = detectWallets();
  const list = $<HTMLUListElement>('wallet-list');
  list.innerHTML = '';

  if (wallets.length === 0) {
    setWalletStatus('no compatible wallet detected in this browser', true);
    return;
  }

  setWalletStatus(`${wallets.length} wallet(s) detected — press Connect`);
  for (const wallet of wallets) {
    const item = document.createElement('li');
    const icon = document.createElement('img');
    icon.src = wallet.icon;
    icon.alt = '';
    icon.addEventListener('error', () => icon.remove());
    const name = document.createElement('strong');
    name.textContent = wallet.name;
    const version = document.createElement('span');
    version.className = 'muted';
    version.textContent = `v${wallet.apiVersion}`;
    const connectBtn = document.createElement('button');
    connectBtn.textContent = 'Connect';
    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      const requested = networkSelect.value;
      setWalletStatus(
        `waiting for ${wallet.name} to approve the connection on "${requested}"… look for its prompt or extension popup`,
      );
      const stillWaiting = setTimeout(
        () =>
          setWalletStatus(
            `still waiting for ${wallet.name} — click its icon in the browser toolbar; the prompt may be hidden, or the wallet may be locked`,
          ),
        8000,
      );
      try {
        const api = await connectWallet(wallet, requested);
        const summary = await describeConnection(api);
        setWalletStatus(`connected to ${wallet.name}`);
        const details = $('wallet-details');
        details.hidden = false;
        details.textContent =
          `Network: ${summary.networkId ?? requested}` +
          (summary.shieldedAddress ? ` · Address: ${summary.shieldedAddress.slice(0, 18)}…` : '');
        log(`Connected wallet "${wallet.name}" on ${summary.networkId ?? requested}`, true);

        setWalletStatus(`connected to ${wallet.name} — approve the signing request to derive your key…`);
        log('Asking the wallet to sign a message to derive your employer audit key…', true);
        const derived = await deriveIdentity(api);
        if (derived.source === 'wallet-signature') {
          setWalletStatus(`connected to ${wallet.name} — employer key derived from your signature`);
          log('Employer key derived from your wallet signature', true);
        } else {
          setWalletStatus(`connected to ${wallet.name} — signing unavailable, using throwaway key`, true);
          log(
            `Wallet signing unavailable (${derived.fallbackReason}) — using a throwaway session key instead`,
            false,
          );
        }
        unlock(derived);
      } catch (err) {
        const reason = describeError(err);
        console.error('Wallet connection failed', err);
        setWalletStatus(
          `connection failed: ${reason} — check the wallet is unlocked and try another network id`,
          true,
        );
        log(`Wallet connection failed: ${reason}`, false);
      } finally {
        clearTimeout(stillWaiting);
        connectBtn.disabled = false;
      }
    });
    item.append(icon, name, version, connectBtn);
    list.append(item);
  }
});

$('demo-mode-btn').addEventListener('click', () => {
  setWalletStatus('demo mode — no wallet connected');
  log('Demo mode: using a throwaway session key, no wallet involved', true);
  unlock(randomIdentity('demo mode'));
});

// ------------------------------------------------------------------- audit --

const renderLedger = (l: Ledger): void => {
  $('result-card').hidden = false;

  const badge = $('verdict-badge');
  if (!l.hasResult) {
    badge.textContent = 'no result yet';
    badge.className = 'badge';
  } else if (l.lastCompliant) {
    badge.textContent = '✓ COMPLIANT';
    badge.className = 'badge open';
  } else {
    badge.textContent = '✗ NOT COMPLIANT';
    badge.className = 'badge closed';
  }
  $('verdict-sub').textContent = l.hasResult
    ? `gap within ${l.thresholdPercent}% in every category: ${l.lastCompliant ? 'yes' : 'no'}`
    : '';

  $('res-period').textContent = l.hasResult ? l.lastPeriod : '—';
  $('res-categories').textContent = l.hasResult ? l.lastCategoryCount.toString() : '—';
  $('res-threshold').textContent = `${l.thresholdPercent}%`;
  $('res-round').textContent = l.auditRound.toString();
  $('res-commitment').textContent = l.hasResult ? shortHex(l.lastPayrollCommitment, 24) : '—';
  $('res-employer').textContent = l.employerRegistered ? shortHex(l.employerCommitment, 24) : '—';

  $('observer-view').textContent = JSON.stringify(
    {
      thresholdPercent: l.thresholdPercent.toString(),
      employerRegistered: l.employerRegistered,
      employerCommitment: toHex(l.employerCommitment),
      auditRound: l.auditRound.toString(),
      hasResult: l.hasResult,
      lastCompliant: l.lastCompliant,
      lastPeriod: l.lastPeriod,
      lastCategoryCount: l.lastCategoryCount.toString(),
      lastPayrollCommitment: toHex(l.lastPayrollCommitment),
    },
    null,
    2,
  );
};

$('run-audit-btn').addEventListener('click', async () => {
  if (!identity) return;
  const period = $<HTMLInputElement>('period-input').value.trim() || 'unlabelled';
  const runBtn = $<HTMLButtonElement>('run-audit-btn');
  runBtn.disabled = true;
  try {
    if (categories.length === 0) {
      log('Add at least one category before running an audit', false);
      return;
    }
    const contractCategories = categories.map(toContractCategory);
    const state = createEmployerPrivateState(identity.employerKey, contractCategories, identity.salt);

    log(`Deploying the audit contract (threshold ${THRESHOLD}%)…`, true);
    audit = await AuditClient.deploy(THRESHOLD, state);

    log('Registering as the employer (publishing only a hash of your key)…', true);
    await audit.registerEmployer();

    log(`Proving compliance over ${activeCount(categories)} category(ies) for ${period}…`, true);
    await audit.submitAudit(period, THRESHOLD);

    const l = audit.getLedger();
    log(`Audit published: compliant = ${l.lastCompliant}`, l.lastCompliant);
    renderLedger(l);
  } catch (err) {
    log(`Audit failed: ${describeError(err)}`, false);
  } finally {
    runBtn.disabled = identity === null;
  }
});

// ------------------------------------------------------------------- init --

renderRows();
renderPreview();
renderLock();
