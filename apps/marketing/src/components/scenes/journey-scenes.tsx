import { Check, Mail, MessageCircle } from 'lucide-react';
import { SceneFrame } from '../ui';

/*
 * Static scenes for the journey sections. They all follow the same sample job
 * as the hero (Al Noor Sweets, 5,000 rigid boxes at AED 4.60), so the page
 * tells one story from enquiry to the books.
 */

export function InboxScene() {
  const threads = [
    { icon: MessageCircle, who: 'Al Noor Sweets', text: 'Need 5,000 rigid boxes, 200×150×60…', tag: 'New enquiry', unread: true },
    { icon: Mail, who: 'Gulf Print House', text: 'Revised artwork attached for SO-548', tag: 'Order', unread: false },
    { icon: MessageCircle, who: 'Desert Bloom Florists', text: 'Can we push delivery to Thursday?', tag: 'Delivery', unread: false },
  ];
  const columns = [
    { name: 'Enquiry', cards: [['Desert Bloom', 'AED 8,400']] },
    { name: 'Quoted', cards: [['Al Noor Sweets', 'AED 23,000'], ['Oasis Dates', 'AED 11,250']] },
    { name: 'Won', cards: [['Gulf Print House', 'AED 17,900']] },
  ];
  return (
    <SceneFrame title="Inbox">
      <ul className="divide-y divide-line">
        {threads.map((t) => (
          <li key={t.who} className="flex items-center gap-3 px-4 py-3">
            <t.icon className="h-4 w-4 shrink-0 text-ink-subtle" />
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${t.unread ? 'font-semibold' : ''}`}>{t.who}</p>
              <p className="truncate text-xs text-ink-muted">{t.text}</p>
            </div>
            <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-muted">{t.tag}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2 border-t border-line bg-paper p-3">
        {columns.map((c) => (
          <div key={c.name}>
            <p className="mb-2 px-1 text-[11px] font-medium text-ink-subtle uppercase">{c.name}</p>
            <div className="flex flex-col gap-1.5">
              {c.cards.map(([name, value]) => (
                <div key={name} className="rounded-lg border border-line bg-white px-2 py-1.5">
                  <p className="truncate text-xs font-medium">{name}</p>
                  <p className="font-mono text-[11px] text-ink-muted">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SceneFrame>
  );
}

export function QuoteDocScene() {
  const lines = [
    ['Rigid box 200×150×60, greyboard 2mm, wrapped in 157gsm art paper', '5,000', '4.60', '23,000.00'],
    ['Gold foil lid, one position', 'incl.', '', ''],
  ];
  return (
    <div className="relative">
      <SceneFrame title="Q-1042.pdf">
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">
                M
              </div>
              <p className="mt-2 text-sm font-semibold">Meridian Packaging Co</p>
              <p className="text-xs text-ink-subtle">Sharjah · TRN 100xxxxxxxx0003</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold tracking-tight">Quotation</p>
              <p className="font-mono text-xs text-ink-muted">Q-1042</p>
            </div>
          </div>
          <p className="mt-6 text-xs text-ink-subtle">Prepared for</p>
          <p className="text-sm font-medium">Al Noor Sweets</p>
          <table className="mt-5 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 pl-3 text-right font-medium">Qty</th>
                <th className="py-2 pl-3 text-right font-medium">Unit</th>
                <th className="py-2 pl-3 text-right font-medium">AED</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(([item, qty, unit, total]) => (
                <tr key={item} className="border-b border-line align-top">
                  <td className="py-2 pr-3">{item}</td>
                  <td className="py-2 pl-3 text-right font-mono whitespace-nowrap">{qty}</td>
                  <td className="py-2 pl-3 text-right font-mono whitespace-nowrap">{unit}</td>
                  <td className="py-2 pl-3 text-right font-mono whitespace-nowrap">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 ml-auto w-48 text-xs">
            {[
              ['Subtotal', '23,000.00'],
              ['VAT 5%', '1,150.00'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="font-mono">AED 24,150.00</dd>
            </div>
          </dl>
        </div>
      </SceneFrame>
      <div className="absolute -bottom-5 left-6 flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm shadow-lg">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-good text-white">
          <Check className="h-3 w-3" />
        </span>
        Accepted online by Al Noor Sweets
      </div>
    </div>
  );
}

export function WorkOrderScene() {
  const steps = [
    { name: 'Print', hours: '2.0h', done: true },
    { name: 'Foil lid', hours: '1.5h', done: true },
    { name: 'Die-cut', hours: '3.5h', done: true, justLogged: true },
    { name: 'Wrap', hours: '—', done: false },
    { name: 'Pack', hours: '—', done: false },
  ];
  return (
    <SceneFrame title="WO-318 · 5,000 rigid boxes · SO-552">
      <div className="p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">3 of 5 steps</span>
          <span className="font-mono text-ink-muted">60%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-paper">
          <div className="h-2 w-3/5 rounded-full bg-good" />
        </div>
        <ol className="mt-5 flex flex-col gap-2">
          {steps.map((s) => (
            <li
              key={s.name}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                s.justLogged ? 'border-cut/40 bg-cut-soft' : 'border-line'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  s.done ? 'bg-good text-white' : 'border border-line-strong'
                }`}
              >
                {s.done && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1">{s.name}</span>
              {s.justLogged && <span className="text-xs text-ink-muted">via WhatsApp</span>}
              <span className="font-mono text-ink-muted">{s.hours}</span>
            </li>
          ))}
        </ol>
      </div>
    </SceneFrame>
  );
}

export function StockScene() {
  const rows = [
    { item: 'Greyboard 2mm · 1000×700', onHand: 1400, reserved: 1250, reorder: 500 },
    { item: 'Gold foil · 640mm roll', onHand: 18, reserved: 4, reorder: 6 },
    { item: 'Art paper 157gsm · 1000×700', onHand: 3200, reserved: 1300, reorder: 1000 },
  ];
  return (
    <SceneFrame title="Stock · Main warehouse, Sharjah">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-subtle">
            <th className="px-4 py-2.5 font-medium">Item</th>
            <th className="px-2 py-2.5 text-right font-medium">Reserved</th>
            <th className="px-4 py-2.5 text-right font-medium">Available</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const available = r.onHand - r.reserved;
            const low = available < r.reorder;
            return (
              <tr key={r.item} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{r.item}</td>
                <td className="px-2 py-3 text-right font-mono text-ink-muted">
                  {r.reserved.toLocaleString()}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${low ? 'font-semibold text-cut' : ''}`}>
                  {available.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-3 border-t border-line bg-cut-soft px-4 py-3 text-sm">
        <span>Greyboard is below its reorder point.</span>
        <span className="shrink-0 rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white">
          Draft PO · 2,000 sheets
        </span>
      </div>
    </SceneFrame>
  );
}

export function LedgerScene() {
  const entries = [
    { ref: 'INV-1042 · Al Noor Sweets', lines: [['Accounts receivable', '24,150.00', ''], ['Sales', '', '23,000.00'], ['VAT payable (5%)', '', '1,150.00']] },
    { ref: 'PAY-0391 · Bank transfer', lines: [['Bank — ENBD', '24,150.00', ''], ['Accounts receivable', '', '24,150.00']] },
  ];
  return (
    <SceneFrame title="Journal">
      <div className="divide-y divide-line">
        {entries.map((e) => (
          <div key={e.ref} className="px-4 py-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">{e.ref}</p>
            <table className="w-full text-sm">
              <tbody>
                {e.lines.map(([account, debit, credit]) => (
                  <tr key={account}>
                    <td className={`py-1 ${credit ? 'pl-5' : ''}`}>{account}</td>
                    <td className="w-24 py-1 text-right font-mono">{debit}</td>
                    <td className="w-24 py-1 text-right font-mono text-ink-muted">{credit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line bg-good-soft px-4 py-3 text-sm">
        <span className="font-medium">Trial balance</span>
        <span className="font-mono">Difference 0.00</span>
      </div>
    </SceneFrame>
  );
}
