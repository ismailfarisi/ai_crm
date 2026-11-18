#!/usr/bin/env node
/*
 * One-off migration: import an Invoice Ninja CSV export into a Kerf tenant.
 *
 *   node invoiceninja-import.cjs --dir <csv dir> --tenant <org id|org name> [--dry-run]
 *
 * DB connection comes from DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME
 * (the same env the API uses). Run inside the api container or anywhere with
 * those vars set and `pg` resolvable (APP_DIR points at the app root for
 * module resolution; default is the script's repo checkout).
 *
 * What it does:
 *   - purges this tenant's previously imported rows in the tables it owns
 *     (idempotent reruns on a fresh tenant are a no-op)
 *   - customers      <- clients.csv
 *   - contacts       <- contacts.csv
 *   - catalog_items  <- products.csv
 *   - quotes         <- quotes.csv + quote_items.csv
 *   - draft invoices <- imported as DRAFT quotes (Kerf has no draft-invoice
 *                       status; ISSUED would put them into receivables aging,
 *                       which is document-driven). Their INV#### numbers are
 *                       kept as the quote number so nothing is re-issued.
 *   - issued invoices<- invoices.csv + invoice_items.csv, with original
 *                       numbers, dates, statuses and paid amounts
 *   - backing quotes  - every invoice needs quote_id (NOT NULL, FK). If the
 *                       invoice matches a converted quote (same client, same
 *                       total) it links there; otherwise a minimal
 *                       unnumbered quote row is created for it.
 *   - invoice_payments<- payments.csv, allocated FIFO per client across that
 *                       client's invoices' "paid to date"; shortfalls get a
 *                       synthetic "no payment record" row so sums reconcile.
 *   - credit_notes   <- credits.csv, attached to the client's nearest
 *                       earlier invoice (the export has no invoice link)
 *   - suppliers      <- vendors.csv (+ any PO vendor missing from it)
 *   - purchase_orders<- purchase_orders.csv + purchase_order_items.csv
 *   - journal_entries- opening-balance postings for issued invoices
 *                       (Dr 1100 AR / Cr 4000 Sales / Cr 2200 Tax),
 *                       payments (Dr 3100 Opening balance equity / Cr 1100)
 *                       and issued credit notes (Dr 4000 / Dr 2200 / Cr 1100)
 *                       so the books open with real receivables.
 *   - tenant_sequences bumped so the next generated numbers continue the
 *                       imported series (INV-YYYY-1035 after INV1034, etc.)
 *
 * Draft invoices, the reversed invoice and unapplied payment remainders are
 * reported, never silently dropped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const APP_DIR = process.env.APP_DIR || path.join(__dirname, '..', 'apps', 'api');
const appRequire = createRequire(path.join(APP_DIR, 'package.json'));
const { Client } = appRequire('pg');

/* ---------- args ---------- */
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const CSV_DIR = opt('dir');
const TENANT = opt('tenant');
const DRY_RUN = args.includes('--dry-run');
const PURGE = args.includes('--purge');
if (!CSV_DIR || !TENANT) {
  console.error('usage: --dir <csv dir> --tenant <org id|org name> [--dry-run] [--purge]');
  process.exit(1);
}

/* ---------- csv parsing ---------- */
function parseCsv(file) {
  const t = fs.readFileSync(file, 'utf8');
  const rows = [];
  let cur = [''],
    inQ = false,
    r = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cur[r] += '"';
          i++;
        } else inQ = false;
      } else cur[r] += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') {
        r++;
        cur[r] = '';
      } else if (c === '\n') {
        rows.push(cur);
        cur = [''];
        r = 0;
      } else if (c !== '\r') cur[r] += c;
    }
  }
  rows.push(cur);
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
      return o;
    })
    .filter((o) => Object.values(o).some((v) => v !== ''));
}
const csv = (name) =>
  fs.existsSync(path.join(CSV_DIR, name))
    ? parseCsv(path.join(CSV_DIR, name))
    : [];

/* ---------- value helpers ---------- */
const num = (s) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const str = (s, max) => {
  const v = String(s ?? '').trim();
  if (!v) return null;
  return max ? v.slice(0, max) : v;
};
const email = (s) => {
  const v = str(s, 255);
  return v && v.includes('@') ? v : null;
};
const dt = (s) => {
  const v = str(s);
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return `${v.slice(0, 10)}T10:00:00Z`;
};
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/* For single-line fields like names: source data carries stray \r inside
   "MIDDLE \rEAST" and "TRN 1004…" prefixes inside tax ids. */
const clean = (s, max) => {
  const v = str(s, max);
  return v ? v.replace(/\s+/g, ' ').trim() : null;
};
const taxId = (s) => clean(s, 40)?.replace(/^\s*TRN[: ]*/i, '') ?? null;
const EMIRATE = {
  dubai: 'DXB',
  'abu dhabi': 'AUH',
  abudhabi: 'AUH',
  sharjah: 'SHJ',
  ajman: 'AJM',
  'umm al quwain': 'UAQ',
  uaq: 'UAQ',
  'ras al khaimah': 'RAK',
  'ras al khaima': 'RAK',
  rak: 'RAK',
  fujairah: 'FUJ',
};
const emirateOf = (s) => EMIRATE[norm(s)] ?? null;
const quoteStatus = (s) =>
  ({ Draft: 'DRAFT', Sent: 'AWAITING_APPROVAL', Approved: 'APPROVED', Converted: 'APPROVED', Expired: 'REJECTED' }[s] ??
  'DRAFT');
const poStatus = (s) =>
  ({ Draft: 'DRAFT', Sent: 'SENT', Approved: 'APPROVED', Completed: 'RECEIVED', Cancelled: 'CANCELLED' }[s] ??
  'DRAFT');

function lineItems(rows, numberCol) {
  const items = [];
  for (const r of rows) {
    if (str(r[numberCol]) === null) continue;
    const qty = num(r['Item Quantity']);
    const cost = num(r['Item Cost']);
    const gross = qty * cost;
    const isAmtDisc = num(r['Item Is Amount Discount']) === 1;
    const discAmt = num(r['Item Discount']);
    const discount = isAmtDisc && gross > 0 ? r2((discAmt / gross) * 100) : discAmt;
    items.push({
      id: null, // filled with uuid at insert
      type: 'product',
      description: str(r['Item Notes'], 2000) ?? str(r['Item Product'], 2000) ?? 'Item',
      quantity: qty,
      uom: 'Units',
      unitPrice: cost,
      discount: Math.min(100, Math.max(0, discount)),
      taxRate: Math.max(0, num(r['Item Tax Rate 1'])),
      subtotal: num(r['Item Line Total']) || r2(gross * (1 - Math.min(100, discount) / 100)),
      sku: str(r['Item Product'], 60),
      cost: null,
    });
  }
  return items;
}
const byNumber = (rows, col) => {
  const m = new Map();
  for (const r of rows) {
    const k = str(r[col]);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/* ---------- main ---------- */
const report = { warnings: [], counts: {}, sums: {} };
const warn = (m) => report.warnings.push(m);

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  await client.query(`SET app.bypass_rls = 'on'`);

  const orgRes = await client.query(
    `SELECT id, name, base_currency FROM organizations WHERE id::text = $1 OR slug = $1 OR name = $1`,
    [TENANT],
  );
  if (!orgRes.rows.length) throw new Error(`organization "${TENANT}" not found`);
  const tenantId = orgRes.rows[0].id;
  console.log(`tenant: ${orgRes.rows[0].name} (${tenantId}), base ${orgRes.rows[0].base_currency}`);

  const accounts = {};
  for (const row of (
    await client.query(
      `SELECT id, code, name FROM ledger_accounts WHERE tenant_id = $1 AND code IN ('1100','2200','3100','4000')`,
      [tenantId],
    )
  ).rows)
    accounts[row.code] = row;
  for (const code of ['1100', '2200', '3100', '4000'])
    if (!accounts[code]) throw new Error(`ledger account ${code} missing for tenant`);

  if (DRY_RUN) console.log('--- dry run: nothing will be written ---');
  await client.query('BEGIN');
  try {
    /* Safety: never wipe a tenant that already holds data. The purge only
       runs when explicitly asked or when the tenant is empty anyway. */
    const existing = await client.query(
      `SELECT (SELECT count(*) FROM customers WHERE tenant_id = $1)
             + (SELECT count(*) FROM invoices WHERE tenant_id = $1)
             + (SELECT count(*) FROM quotes WHERE tenant_id = $1) AS n`,
      [tenantId],
    );
    const already = Number(existing.rows[0].n);
    if (already > 0 && !PURGE)
      throw new Error(
        `tenant already has ${already} customers/quotes/invoices — refusing to run without --purge`,
      );
    /* purge prior imported rows for this tenant (fresh tenant: no-op) */
    for (const q of [
      `DELETE FROM invoice_payments WHERE tenant_id = $1`,
      `DELETE FROM credit_note_lines WHERE tenant_id = $1`,
      `DELETE FROM credit_notes WHERE tenant_id = $1`,
      `DELETE FROM invoices WHERE tenant_id = $1`,
      `DELETE FROM quotes WHERE tenant_id = $1`,
      `DELETE FROM purchase_order_lines WHERE tenant_id = $1`,
      `DELETE FROM purchase_orders WHERE tenant_id = $1`,
      `DELETE FROM catalog_items WHERE tenant_id = $1`,
      `DELETE FROM contacts WHERE tenant_id = $1`,
      `DELETE FROM customers WHERE tenant_id = $1`,
      `DELETE FROM suppliers WHERE tenant_id = $1`,
      `DELETE FROM journal_entries WHERE "tenantId" = $1`,
      `DELETE FROM tenant_sequences WHERE tenant_id = $1`,
      `DELETE FROM import_runs WHERE tenant_id = $1`,
      `DELETE FROM audit_logs WHERE tenant_id = $1 AND action = 'import.invoiceninja'`,
    ])
      await client.query(q, [tenantId]);

    /* ---------- customers ---------- */
    const clientRows = csv('clients (1).csv').length ? csv('clients (1).csv') : csv('clients.csv');
    const customerIdByName = new Map();
    const usedNames = new Set();
    const addCustomer = async (name, fields = {}) => {
      let company = clean(name, 120) ?? 'Unknown';
      let candidate = company;
      for (let i = 2; usedNames.has(norm(candidate)); i++) candidate = `${company.slice(0, 110)} (${i})`;
      company = candidate;
      usedNames.add(norm(company));
      const res = await client.query(
        `INSERT INTO customers (tenant_id,"companyName","contactName",email,phone,"addressLine1","addressLine2",city,"postalCode",country,"taxId",emirate,"vatStatus",currency,"paymentTermsDays",notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          tenantId,
          company,
          str(fields.contactName, 120),
          email(fields.email),
          str(fields.phone, 40),
          str(fields.street, 160),
          str(fields.apt, 160),
          str(fields.city, 80),
          str(fields.postal, 20),
          str(fields.country, 80),
          taxId(fields.taxId),
          emirateOf(fields.state),
          fields.country && norm(fields.country) !== 'united arab emirates'
            ? 'OUTSIDE_UAE'
            : str(fields.taxId)
              ? 'REGISTERED'
              : 'NOT_REGISTERED',
          str(fields.currency, 3),
          fields.paymentTermsDays ?? null,
          str(fields.notes),
        ],
      );
      return res.rows[0].id;
    };
    for (const r of clientRows) {
      const name = str(r['Name']);
      if (!name) continue;
      const contactName = [str(r['First Name']), str(r['Last Name'])].filter(Boolean).join(' ') || null;
      const id = await addCustomer(name, {
        contactName,
        email: r['Email'],
        phone: r['Client Phone'] || r['Contact Phone'],
        street: r['Street'],
        apt: r['Apt/Suite'],
        city: r['City'],
        postal: r['Postal Code'],
        country: r['Country'],
        taxId: r['VAT Number'],
        currency: r['Client Currency'],
        state: r['State/Province'],
        paymentTermsDays: (r['Client Payment Terms'] || '').match(/\d+/)?.[0]
          ? parseInt(r['Client Payment Terms'].match(/\d+/)[0], 10)
          : null,
        notes: [
          `Invoice Ninja client #${str(r['Number'])}`,
          str(r['Public Notes']),
          str(r['Private Notes']) ? `Private: ${str(r['Private Notes'])}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      customerIdByName.set(norm(name), id);
    }
    report.counts.customers = customerIdByName.size;

    const ensureCustomer = async (clientName) => {
      const key = norm(clientName);
      if (!key) return null;
      if (!customerIdByName.has(key)) {
        const id = await addCustomer(clientName, { notes: 'Created during import — not in clients.csv' });
        customerIdByName.set(key, id);
        warn(`client "${clientName}" not in clients.csv — created a bare customer row`);
      }
      return customerIdByName.get(key);
    };
    const customerEmail = new Map();
    for (const r of clientRows) {
      const id = customerIdByName.get(norm(r['Name']));
      if (id && email(r['Email'])) customerEmail.set(id, email(r['Email']));
    }

    /* ---------- contacts ---------- */
    let contactCount = 0;
    for (const r of csv('contacts.csv')) {
      const first = str(r['Contact First Name'], 80) ?? str(r['Client Name'], 80) ?? 'Contact';
      const last = str(r['Contact Last Name'], 80) ?? '-';
      await client.query(
        `INSERT INTO contacts (tenant_id,"firstName","lastName",email,phone,company,status,source,notes)
         VALUES ($1,$2,$3,$4,$5,$6,'customer','other',$7)`,
        [
          tenantId,
          first,
          last,
          email(r['Contact Email']),
          str(r['Contact Phone'], 40),
          str(r['Client Name'], 120),
          str(r['Client Number']) ? `Client #${str(r['Client Number'])}` : null,
        ],
      );
      contactCount++;
    }
    report.counts.contacts = contactCount;

    /* ---------- catalog items ---------- */
    const prodRows = csv('products (1).csv').length ? csv('products (1).csv') : csv('products.csv');
    const skuUsed = new Set();
    let prodCount = 0;
    for (const r of prodRows) {
      const key = str(r['Product']);
      if (!key) continue;
      let sku = key.slice(0, 60);
      if (skuUsed.has(norm(sku))) {
        let i = 2;
        while (skuUsed.has(norm(`${sku.slice(0, 55)}~${i}`))) i++;
        sku = `${sku.slice(0, 55)}~${i}`;
      }
      skuUsed.add(norm(sku));
      await client.query(
        `INSERT INTO catalog_items (tenant_id, sku, name, description, uom, list_price, standard_cost, tax_rate)
         VALUES ($1,$2,$3,$4,'Units',$5,$6,$7)`,
        [tenantId, sku, key.slice(0, 200), str(r['Notes']), num(r['Price']), num(r['Cost']), num(r['Tax Rate 1'])],
      );
      prodCount++;
    }
    report.counts.catalogItems = prodCount;

    /* ---------- quotes ---------- */
    const quoteRows = csv('quotes (1).csv').length ? csv('quotes (1).csv') : csv('quotes.csv');
    const quoteItemRows = csv('quote_items.csv');
    const qItems = byNumber(quoteItemRows, 'Quotation Number');
    const quoteIdByNumber = new Map(); // source number -> quote row id
    const insertQuote = async (q) => {
      const res = await client.query(
        `INSERT INTO quotes (tenant_id, quote_number, customer_id, customer_name, customer_email, "createdBy", status,
           title, valid_until, payment_terms, currency, items, subtotal_amount, discount_amount, tax_amount, "totalAmount",
           terms_and_conditions, notes, created_at, updated_at, accepted_at)
         VALUES ($1,$2,$3,$4,$5,'HUMAN',$6,$7,$8,'immediate',$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18) RETURNING id`,
        [
          tenantId,
          q.number,
          q.customerId,
          q.customerName,
          q.customerEmail,
          q.status,
          q.title,
          q.validUntil,
          q.currency,
          JSON.stringify(q.items),
          q.subtotal,
          q.discount,
          q.tax,
          q.total,
          q.terms,
          q.notes,
          q.createdAt,
          q.acceptedAt,
        ],
      );
      return res.rows[0].id;
    };
    for (const r of quoteRows) {
      const number = str(r['Quotation Number']);
      if (!number) continue;
      const custId = await ensureCustomer(r['Client Name']);
      const status = quoteStatus(r['Quotation Status']);
      const items = lineItems(qItems.get(number) ?? [], 'Quotation Number');
      const id = await insertQuote({
        number,
        customerId: custId,
        customerName: clean(r['Client Name'], 255) ?? 'General Customer',
        customerEmail: customerEmail.get(custId) ?? null,
        status,
        title: `${number} — ${clean(r['Client Name'], 200) ?? 'quote'}`,
        validUntil: dt(r['Quotation Valid Until']),
        currency: str(r['Client Currency'], 3) ?? 'AED',
        items,
        subtotal: num(r['Quotation Subtotal']),
        discount: num(r['Quotation Discount']),
        tax: num(r['Quotation Tax Amount']),
        total: num(r['Quotation Amount']),
        terms: [str(r['Quotation Terms']), str(r['Quotation Footer'])].filter(Boolean).join('\n\n') || null,
        notes:
          [str(r['Quotation Public Notes']), str(r['Quotation Private Notes'])]
            .filter(Boolean)
            .join('\n\n') || null,
        createdAt: dt(r['Quotation Date']) ?? new Date().toISOString(),
        acceptedAt: status === 'APPROVED' ? dt(r['Quotation Date']) : null,
      });
      quoteIdByNumber.set(number, { id, status: r['Quotation Status'], client: norm(r['Client Name']), total: num(r['Quotation Amount']), date: r['Quotation Date'] });
    }
    report.counts.quotes = quoteIdByNumber.size;

    /* ---------- invoices ---------- */
    const invoiceRows = csv('invoices.csv');
    const invItemRows = csv('invoice_items.csv');
    const iItems = byNumber(invItemRows, 'Tax Invoice Invoice Number');
    const invoiceById = new Map(); // uuid -> {number, amount, clientKey, paidToDate, currency, issuedAt}
    let draftAsQuotes = 0;
    for (const r of invoiceRows) {
      const number = str(r['Tax Invoice Invoice Number']);
      if (!number) continue;
      const srcStatus = r['Tax Invoice Status'];
      const custId = await ensureCustomer(r['Client Name']);
      const items = lineItems(iItems.get(number) ?? [], 'Tax Invoice Invoice Number');
      if (srcStatus === 'Draft') {
        // No draft-invoice status in Kerf: becomes a draft quote, keeping the
        // INV number so it can't be re-issued and the history is findable.
        const id = await insertQuote({
          number,
          customerId: custId,
          customerName: clean(r['Client Name'], 255) ?? 'General Customer',
          customerEmail: customerEmail.get(custId) ?? null,
          status: 'DRAFT',
          title: `Draft invoice ${number} — ${clean(r['Client Name'], 180) ?? ''}`,
          validUntil: dt(r['Tax Invoice Due Date']),
          currency: str(r['Client Currency'], 3) ?? 'AED',
          items,
          subtotal: num(r['Tax Invoice Subtotal']),
          discount: num(r['Tax Invoice Discount']),
          tax: num(r['Tax Invoice Tax Amount']),
          total: num(r['Tax Invoice Amount']),
          terms: [str(r['Tax Invoice Terms']), str(r['Tax Invoice Footer'])].filter(Boolean).join('\n\n') || null,
          notes:
            [
              `Draft invoice ${number} in the source system (never sent); imported as a draft quote.`,
              str(r['Tax Invoice Public Notes']),
              str(r['Tax Invoice Private Notes']),
            ]
              .filter(Boolean)
              .join('\n\n'),
          createdAt: dt(r['Tax Invoice Date']) ?? new Date().toISOString(),
          acceptedAt: null,
        });
        quoteIdByNumber.set(number, { id, status: 'DraftInvoice', client: norm(r['Client Name']), total: num(r['Tax Invoice Amount']), date: r['Tax Invoice Date'] });
        draftAsQuotes++;
        continue;
      }
      // match to a converted quote of the same client with the same total
      const clientKey = norm(r['Client Name']);
      const total = num(r['Tax Invoice Amount']);
      let quoteId = null;
      const candidates = [...quoteIdByNumber.entries()].filter(
        ([, q]) => q.status === 'Converted' && q.client === clientKey && Math.abs(q.total - total) < 0.05,
      );
      if (candidates.length === 1) quoteId = candidates[0][1].id;
      if (!quoteId) {
        quoteId = await insertQuote({
          number: null,
          customerId: custId,
          customerName: clean(r['Client Name'], 255) ?? 'General Customer',
          customerEmail: customerEmail.get(custId) ?? null,
          status: 'APPROVED',
          title: `Imported invoice ${number} — ${clean(r['Client Name'], 180) ?? ''}`,
          validUntil: null,
          currency: str(r['Client Currency'], 3) ?? 'AED',
          items,
          subtotal: num(r['Tax Invoice Subtotal']),
          discount: num(r['Tax Invoice Discount']),
          tax: num(r['Tax Invoice Tax Amount']),
          total,
          terms: [str(r['Tax Invoice Terms']), str(r['Tax Invoice Footer'])].filter(Boolean).join('\n\n') || null,
          notes: `Backing quote for imported invoice ${number}.`,
          createdAt: dt(r['Tax Invoice Date']) ?? new Date().toISOString(),
          acceptedAt: null,
        });
      }
      const status =
        srcStatus === 'Reversed'
          ? 'CANCELLED'
          : num(r['Tax Invoice Paid to Date']) >= total - 0.01 && total > 0
            ? 'PAID'
            : num(r['Tax Invoice Paid to Date']) > 0
              ? 'PARTIALLY_PAID'
              : 'ISSUED';
      const res = await client.query(
        `INSERT INTO invoices (id, tenant_id, quote_id, invoice_number, customer_id, customer_name, customer_email,
           currency, items, subtotal_amount, discount_amount, tax_amount, amount, status, payment_terms, due_date,
           notes, paid_amount, sent_at, voided_at, issued_at, tax_breakdown, fx_rate)
         VALUES (uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'immediate',$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id`,
        [
          tenantId,
          quoteId,
          number,
          custId,
          clean(r['Client Name'], 255) ?? 'General Customer',
          customerEmail.get(custId) ?? null,
          str(r['Client Currency'], 3) ?? 'AED',
          JSON.stringify(items),
          num(r['Tax Invoice Subtotal']),
          num(r['Tax Invoice Discount']),
          num(r['Tax Invoice Tax Amount']),
          total,
          status,
          dt(r['Tax Invoice Due Date']),
          [str(r['Tax Invoice Public Notes']), str(r['Tax Invoice Private Notes'])].filter(Boolean).join('\n\n') || null,
          num(r['Tax Invoice Paid to Date']),
          status === 'CANCELLED' ? null : dt(r['Tax Invoice Date']),
          status === 'CANCELLED' ? dt(r['Tax Invoice Date']) : null,
          dt(r['Tax Invoice Date']) ?? new Date().toISOString(),
          num(r['Tax Invoice Tax Amount']) > 0
            ? JSON.stringify([{ taxCodeId: null, code: 'VAT', net: num(r['Tax Invoice Subtotal']), rate: 5, tax: num(r['Tax Invoice Tax Amount']), reverseCharge: false }])
            : null,
          num(r['Tax Invoice Exchange Rate']) || 1,
        ],
      );
      invoiceById.set(res.rows[0].id, {
        number,
        amount: total,
        tax: num(r['Tax Invoice Tax Amount']),
        subtotal: num(r['Tax Invoice Subtotal']),
        clientKey,
        paidToDate: num(r['Tax Invoice Paid to Date']),
        currency: str(r['Client Currency'], 3) ?? 'AED',
        issuedAt: dt(r['Tax Invoice Date']),
        dueDate: dt(r['Tax Invoice Due Date']),
        status,
      });
    }
    report.counts.invoices = invoiceById.size;
    report.counts.draftInvoicesAsQuotes = draftAsQuotes;

    /* ---------- payments ---------- */
    const payRows = csv('payments.csv')
      .map((r) => ({
        client: norm(r['Client Name']),
        clientName: r['Client Name'],
        date: dt(r['Payment Date']),
        applied: num(r['Payment Applied']),
        amount: num(r['Payment Amount']),
        number: str(r['Payment Number']),
        method: str(r['Payment Method']),
        ref: str(r['Payment Transaction Reference']),
      }))
      .filter((p) => p.number && p.applied > 0);
    const pool = new Map();
    for (const p of payRows) {
      if (!pool.has(p.client)) pool.set(p.client, []);
      pool.get(p.client).push({ ...p, left: p.applied });
    }
    for (const arr of pool.values()) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const paidInvoices = [...invoiceById.entries()]
      .filter(([, i]) => i.paidToDate > 0)
      .sort((a, b) => String(a[1].issuedAt).localeCompare(String(b[1].issuedAt)));
    const insertedPayments = [];
    let paymentRows = 0;
    for (const [invId, inv] of paidInvoices) {
      let need = r2(inv.paidToDate);
      const clientPool = pool.get(inv.clientKey) ?? [];
      for (const p of clientPool) {
        if (need <= 0.004) break;
        if (p.left <= 0.004) continue;
        const take = r2(Math.min(need, p.left));
        p.left = r2(p.left - take);
        need = r2(need - take);
        insertedPayments.push({ invId, inv, amount: take, date: p.date, notes: `Imported payment ${p.number}${p.method ? ` — ${p.method}` : ''}${p.ref ? ` ref ${p.ref}` : ''}`, entry: `JE-PMT-${p.number}` });
      }
      if (need > 0.004) {
        insertedPayments.push({
          invId,
          inv,
          amount: need,
          date: inv.dueDate ?? inv.issuedAt,
          notes: 'Imported balance — no payment record in export',
          entry: `JE-PMT-${inv.number}-IMP`,
        });
      }
    }
    // one payment can span invoices — suffix extra journal numbers so they read distinctly
    const entrySeen = new Map();
    for (const p of insertedPayments) {
      const seen = entrySeen.get(p.entry) ?? 0;
      entrySeen.set(p.entry, seen + 1);
      if (seen > 0) p.entry = `${p.entry}-${seen + 1}`;
    }
    const lastPayByInv = new Map();
    for (const p of insertedPayments) {
      const prev = lastPayByInv.get(p.invId);
      if (!prev || String(p.date) > String(prev)) lastPayByInv.set(p.invId, p.date);
    }
    for (const [invId, inv] of invoiceById) {
      if (inv.status === 'PAID' && lastPayByInv.has(invId))
        await client.query(`UPDATE invoices SET paid_at = $2 WHERE id = $1`, [invId, lastPayByInv.get(invId)]);
    }
    for (const [clientKey, arr] of pool) {
      const left = r2(arr.reduce((s, p) => s + p.left, 0));
      if (left > 0.005) warn(`unapplied payment remainder ${left} for client "${arr[0].clientName}" (no matching invoice capacity)`);
    }
    for (const p of insertedPayments) {
      await client.query(
        `INSERT INTO invoice_payments (tenant_id, invoice_id, amount, paid_at, notes, fx_rate) VALUES ($1,$2,$3,$4,$5,1)`,
        [tenantId, p.invId, p.amount, p.date, p.notes],
      );
      paymentRows++;
    }
    report.counts.invoicePayments = paymentRows;

    /* ---------- credit notes ---------- */
    let cnCount = 0;
    const issuedCreditTotals = new Map(); // invoiceId -> amount
    for (const r of csv('credits.csv')) {
      const number = str(r['Credit Credit Number']);
      if (!number) continue;
      const clientKey = norm(r['Client Name']);
      const custId = await ensureCustomer(r['Client Name']);
      const creditDate = dt(r['Credit Date']);
      const clientInvoices = [...invoiceById.entries()]
        .filter(([, i]) => i.clientKey === clientKey)
        .sort((a, b) => String(b[1].issuedAt).localeCompare(String(a[1].issuedAt)));
      const before = clientInvoices.filter(([, i]) => String(i.issuedAt) <= String(creditDate));
      const target = (before[0] ?? clientInvoices[0])?.[0];
      if (!target) {
        warn(`credit ${number} for "${r['Client Name']}" skipped — no invoice to attach to`);
        continue;
      }
      const total = num(r['Credit Amount']);
      const sub = num(r['Credit Subtotal']) || total - num(r['Credit Tax Amount']);
      const tax = num(r['Credit Tax Amount']);
      const status = r['Credit Status'] === 'Draft' ? 'DRAFT' : 'ISSUED';
      const res = await client.query(
        `INSERT INTO credit_notes (tenant_id, credit_note_number, status, invoice_id, customer_id, customer_name,
           currency, reason, subtotal_amount, tax_amount, total_amount, tax_breakdown, issued_at, fx_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          tenantId,
          number,
          status,
          target,
          custId,
          clean(r['Client Name'], 255) ?? 'Customer',
          str(r['Client Currency'], 3) ?? 'AED',
          str(r['Credit Public Notes']) ?? `Imported credit note ${number}`,
          sub,
          tax,
          total,
          JSON.stringify(tax > 0 ? [{ taxCodeId: null, code: 'VAT', net: sub, rate: 5, tax, reverseCharge: false }] : []),
          status === 'ISSUED' ? creditDate : null,
          num(r['Credit Exchange Rate']) || 1,
        ],
      );
      const cnId = res.rows[0].id;
      await client.query(
        `INSERT INTO credit_note_lines (tenant_id, credit_note_id, sequence, description, qty, unit_price, net, tax_rate)
         VALUES ($1,$2,1,$3,1,$4,$5,$6)`,
        [tenantId, cnId, `Imported credit note ${number}`, sub, sub, sub > 0 ? r2((tax / sub) * 100) : 0],
      );
      if (status === 'ISSUED') {
        issuedCreditTotals.set(target, r2((issuedCreditTotals.get(target) ?? 0) + total));
        const inv = invoiceById.get(target);
        (inv.jeCredits = inv.jeCredits ?? []).push({ cnId, number, total, sub, tax, date: creditDate });
      }
      cnCount++;
    }
    for (const [invId, amt] of issuedCreditTotals) {
      const inv = invoiceById.get(invId);
      const newCredited = r2(amt);
      const balance = r2(inv.amount - inv.paidToDate - newCredited);
      await client.query(`UPDATE invoices SET credited_amount = $2${balance <= 0 ? `, status='PAID'` : ''} WHERE id = $1`, [invId, newCredited]);
    }
    report.counts.creditNotes = cnCount;

    /* ---------- suppliers ---------- */
    const supplierIdByName = new Map();
    for (const r of csv('vendors.csv')) {
      const name = clean(r['Vendor Name'], 120);
      if (!name) continue;
      const contactName = [clean(r['Vendor First Name']), clean(r['Vendor Last Name'])].filter(Boolean).join(' ') || null;
      const res = await client.query(
        `INSERT INTO suppliers (tenant_id, company_name, contact_name, email, phone, address_line1, address_line2,
           city, postal_code, country, tax_id, emirate, currency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          tenantId,
          name,
          contactName,
          email(r['Vendor Email']),
          str(r['Vendor Phone'] || r['Vendor Contact Phone'], 40),
          str(r['Vendor Street'], 160),
          str(r['Vendor Apt/Suite'], 160),
          str(r['Vendor City'], 80),
          str(r['Vendor Postal Code'], 20),
          str(r['Vendor Country'], 80),
          taxId(r['Vendor VAT Number']),
          emirateOf(r['Vendor State/Province']),
          str(r['Vendor Currency'], 3),
          [
            str(r['Vendor Number']) ? `Vendor #${str(r['Vendor Number'])}` : null,
            str(r['Vendor Public Notes']),
            str(r['Vendor Private Notes']) ? `Private: ${str(r['Vendor Private Notes'])}` : null,
          ]
            .filter(Boolean)
            .join('\n') || null,
        ],
      );
      supplierIdByName.set(norm(name), res.rows[0].id);
    }
    report.counts.suppliers = supplierIdByName.size;

    /* ---------- purchase orders ---------- */
    const poItemRows = csv('purchase_order_items.csv');
    const poItems = byNumber(poItemRows, 'Purchase Order Number');
    let poCount = 0;
    for (const r of csv('purchase_orders.csv')) {
      const number = str(r['Purchase Order Number']);
      if (!number) continue;
      const vendorName = clean(r['Vendor Name'], 120) ?? clean(r['Purchase Order Vendor'], 120) ?? 'Unknown supplier';
      let supId = supplierIdByName.get(norm(vendorName));
      if (!supId) {
        const res = await client.query(
          `INSERT INTO suppliers (tenant_id, company_name, notes) VALUES ($1,$2,'Created during import — not in vendors.csv') RETURNING id`,
          [tenantId, vendorName.slice(0, 120)],
        );
        supId = res.rows[0].id;
        supplierIdByName.set(norm(vendorName), supId);
        warn(`PO vendor "${vendorName}" not in vendors.csv — created a bare supplier row`);
      }
      const status = poStatus(r['Purchase Order Status']);
      const res = await client.query(
        `INSERT INTO purchase_orders (tenant_id, po_number, supplier_id, supplier_name, status, currency,
           order_date, expected_date, subtotal_amount, total_amount, notes, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          tenantId,
          number,
          supId,
          vendorName.slice(0, 120),
          status,
          str(r['Purchase Order Currency'], 3) ?? 'AED',
          dt(r['Purchase Order Date']) ?? new Date().toISOString(),
          dt(r['Purchase Order Due Date']),
          num(r['Purchase Order Subtotal']),
          num(r['Purchase Order Amount']),
          [str(r['Purchase Order Public Notes']), str(r['Purchase Order Private Notes']), str(r['Purchase Order Terms']), str(r['Purchase Order Footer'])]
            .filter(Boolean)
            .join('\n\n') || null,
          status === 'SENT' || status === 'RECEIVED' ? dt(r['Purchase Order Date']) : null,
        ],
      );
      const poId = res.rows[0].id;
      for (const it of poItems.get(number) ?? []) {
        await client.query(
          `INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, description, qty_ordered, qty_received, uom, unit_cost, line_total)
           VALUES ($1,$2,$3,$4,0,'EACH',$5,$6)`,
          [
            tenantId,
            poId,
            (str(it['Item Notes']) ?? str(it['Item Product']) ?? 'Item').slice(0, 255),
            num(it['Item Quantity']),
            num(it['Item Cost']),
            num(it['Item Line Total']) || r2(num(it['Item Quantity']) * num(it['Item Cost'])),
          ],
        );
      }
      poCount++;
    }
    report.counts.purchaseOrders = poCount;

    /* ---------- journal entries (opening balances) ---------- */
    const acc = (code, name) => ({
      ledgerAccountId: accounts[code].id,
      ledgerAccountCode: code,
      financeAccountId: null,
      accountName: name,
    });
    let jeCount = 0;
    for (const [invId, inv] of invoiceById) {
      if (inv.status === 'CANCELLED') continue; // reversed: issue+payment+void nets to zero
      const total = r2(inv.amount);
      if (total > 0) {
        const lines = [
          { ...acc('1100', 'Accounts Receivable'), debit: total, credit: 0, description: `Invoice ${inv.number}` },
        ];
        const sales = r2(total - r2(inv.tax));
        if (sales > 0) lines.push({ ...acc('4000', 'Sales'), debit: 0, credit: sales, description: `Invoice ${inv.number}` });
        if (inv.tax > 0) lines.push({ ...acc('2200', 'Tax payable'), debit: 0, credit: r2(inv.tax), description: `Invoice ${inv.number}` });
        await client.query(
          `INSERT INTO journal_entries ("tenantId","entryNumber","referenceType","referenceId","entryDate","totalAmount",currency,fx_rate,lines)
           VALUES ($1,$2,'INVOICE',$3,$4,$5,$6,1,$7)`,
          [tenantId, `JE-${inv.number}`, invId, inv.issuedAt, total, inv.currency, JSON.stringify(lines)],
        );
        jeCount++;
      }
      for (const c of inv.jeCredits ?? []) {
        const lines = [
          { ...acc('4000', 'Sales'), debit: c.sub, credit: 0, description: `Credit note ${c.number} against ${inv.number}` },
        ];
        if (c.tax > 0) lines.push({ ...acc('2200', 'Tax payable'), debit: c.tax, credit: 0, description: `Credit note ${c.number} against ${inv.number}` });
        lines.push({ ...acc('1100', 'Accounts Receivable'), debit: 0, credit: c.total, description: `Credit note ${c.number} against ${inv.number}` });
        await client.query(
          `INSERT INTO journal_entries ("tenantId","entryNumber","referenceType","referenceId","entryDate","totalAmount",currency,fx_rate,lines)
           VALUES ($1,$2,'CREDIT_NOTE',$3,$4,$5,$6,1,$7)`,
          [tenantId, `JE-CN-${c.number}`, c.cnId, c.date, c.total, inv.currency, JSON.stringify(lines)],
        );
        jeCount++;
      }
    }
    for (const p of insertedPayments) {
      if (p.inv.status === 'CANCELLED') continue;
      const lines = [
        { ...acc('3100', 'Opening balance equity'), debit: p.amount, credit: 0, description: `Payment on ${p.inv.number}` },
        { ...acc('1100', 'Accounts Receivable'), debit: 0, credit: p.amount, description: `Payment on ${p.inv.number}` },
      ];
      await client.query(
        `INSERT INTO journal_entries ("tenantId","entryNumber","referenceType","referenceId","entryDate","totalAmount",currency,fx_rate,lines)
         VALUES ($1,$2,'INVOICE',$3,$4,$5,$6,1,$7)`,
        [tenantId, p.entry, p.invId, p.date, p.amount, p.inv.currency, JSON.stringify(lines)],
      );
      jeCount++;
    }
    report.counts.journalEntries = jeCount;

    /* ---------- sequences: continue the imported numbering ---------- */
    const maxOf = (numbers, re) =>
      numbers.reduce((m, n) => {
        const mm = re.exec(n);
        return mm ? Math.max(m, parseInt(mm[1], 10)) : m;
      }, 0);
    // Drafts consumed INV numbers in the source system too, so the invoice
    // sequence continues past the max of every exported invoice number, not
    // just the ones that landed in `invoices`.
    const invMax = maxOf(invoiceRows.map((r) => str(r['Tax Invoice Invoice Number'])), /(\d+)$/);
    // Current series = prefix of the most recent real quote (e.g. AJ0571).
    // Max is taken only over quotes dated within a year of the newest, so a
    // one-off high number from years ago (AJ10026 @2022) doesn't jump the series.
    const quoteDates = [...quoteIdByNumber.entries()]
      .filter(([n, q]) => q.status !== 'DraftInvoice' && /^[A-Z]+\d+$/.test(n))
      .sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)));
    const currentPrefix = quoteDates.length ? (quoteDates[0][0].match(/^[A-Z]+/) ?? [''])[0] : '';
    const newestDate = quoteDates.length ? new Date(quoteDates[0][1].date) : new Date();
    const cutoff = new Date(newestDate.getTime() - 365 * 86400_000);
    const quoteMax = maxOf(
      quoteDates
        .filter(([n, q]) => n.startsWith(currentPrefix) && new Date(q.date) >= cutoff)
        .map(([n]) => n),
      /(\d+)$/,
    );
    const poMax = maxOf(
      csv('purchase_orders.csv').map((r) => str(r['Purchase Order Number'])),
      /(\d+)$/,
    );
    const cnMax = maxOf(
      csv('credits.csv').map((r) => str(r['Credit Credit Number'])),
      /(\d+)$/,
    );
    const seqs = { invoice_number: invMax, quote_number: quoteMax, purchase_order_number: poMax, credit_note_number: cnMax };
    for (const [name, value] of Object.entries(seqs)) {
      if (!value) continue;
      await client.query(
        `INSERT INTO tenant_sequences (tenant_id, sequence_name, current_value) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, sequence_name) DO UPDATE SET current_value = $3, updated_at = now()`,
        [tenantId, name, value],
      );
    }
    report.sequences = seqs;

    /* ---------- import_runs + audit ---------- */
    for (const [entity, count] of Object.entries(report.counts)) {
      await client.query(
        `INSERT INTO import_runs (tenant_id, entity, file_name, on_duplicate, total_rows, created, updated, skipped, failed)
         VALUES ($1,$2,$3,'skip',$4,$4,0,0,0)`,
        [tenantId, entity, 'Invoice Ninja export', count],
      );
    }
    await client.query(
      `INSERT INTO audit_logs (tenant_id, action, subject_type, summary, origin, origin_channel, after)
       VALUES ($1,'import.invoiceninja','IMPORT',$2,'HUMAN','WEB',$3)`,
      [
        tenantId,
        `Invoice Ninja migration: ${report.counts.customers} customers, ${report.counts.invoices} invoices, ${report.counts.quotes}+${report.counts.draftInvoicesAsQuotes} quotes, ${report.counts.invoicePayments} payments`.slice(0, 200),
        JSON.stringify({ counts: report.counts, sequences: report.sequences }),
      ],
    );

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('dry run rolled back');
    } else {
      await client.query('COMMIT');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  await client.end();
  return report;
}

main()
  .then((r) => {
    console.log('\n===== import report =====');
    console.log(JSON.stringify({ counts: r.counts, sequences: r.sequences, warnings: r.warnings }, null, 2));
  })
  .catch((e) => {
    console.error('IMPORT FAILED (rolled back):', e.message);
    console.error(e);
    process.exit(1);
  });
