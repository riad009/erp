// অ্যাক্টিভিটি মুছুন / ফেরান (owner's way):
//   মুছুন  = take only this one change out of the record (red dotted card)
//   ফেরান = put the same change back (green dotted card) — and again, as often as needed.
// A change is stored as the record before (`before`) and after (`after`) the save. Only the lines and fields
// that this save touched are swapped, so later changes on the same party / day / company stay as they are.

type Data = Record<string, unknown>;
const clone = <T>(o: T): T => (o == null ? o : JSON.parse(JSON.stringify(o)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// lists of lines inside a record, matched line by line
const LISTS = ['entries', 'outs', 'items', 'list'];
// a line's identity (stock lines have no id: their time + size is unique)
const keyOf = (x: unknown) => {
  const o = (x || {}) as Data;
  return o.id != null ? 'i:' + o.id : o.ce ? 'c:' + o.ce : `t:${o.ts ?? ''}|${o.item ?? ''}|${o.kg ?? ''}`;
};

// move `cur` the way the record went from `from` to `to`, touching only what that change touched
// (from = null: the change made the record · to = null: the change deleted the record)
export function applyChange(cur: Data | null, from: Data | null, to: Data | null): Data | null {
  if (!to) {
    // target = "record not there": take this change's lines out; the record goes only if nothing else is left
    if (!cur || !from) return cur ? clone(cur) : null;
    const out = clone(cur);
    for (const k of LISTS) if (Array.isArray(from[k]) && Array.isArray(out[k])) {
      const ks = new Set((from[k] as unknown[]).map(keyOf));
      out[k] = (out[k] as unknown[]).filter(x => !ks.has(keyOf(x)));
    }
    if (from.map && out.map) for (const [d, v] of Object.entries(from.map as Data)) if (same((out.map as Data)[d], v)) delete (out.map as Data)[d];
    const left = LISTS.some(k => Array.isArray(out[k]) && (out[k] as unknown[]).length) || (out.map && Object.keys(out.map as Data).length);
    return left ? out : null;
  }
  if (!cur) return clone(to);   // the record is not there → it comes back as this change left it
  const f = from || {}, t = to, out: Data = clone(cur);
  for (const k of new Set([...Object.keys(f), ...Object.keys(t)])) {
    const a = f[k], b = t[k];
    if (same(a, b)) continue;
    if (LISTS.includes(k) && (Array.isArray(a) || Array.isArray(b))) {
      const A = new Map(((a as Data[]) || []).map(x => [keyOf(x), x])), B = new Map(((b as Data[]) || []).map(x => [keyOf(x), x]));
      let list = ((out[k] as Data[]) || []).slice();
      for (const [key] of A) if (!B.has(key)) list = list.filter(x => keyOf(x) !== key);               // this change removed it
      for (const [key, x] of B) {
        const i = list.findIndex(y => keyOf(y) === key);
        if (!A.has(key)) { if (i < 0) list.push(clone(x)); }                                              // this change added it
        else if (!same(A.get(key), x)) { if (i >= 0) list[i] = clone(x); else list.push(clone(x)); }    // this change edited it
      }
      out[k] = list;
    } else if (k === 'map' && typeof (a || b) === 'object') {
      const m = { ...((out.map as Data) || {}) }, am = (a || {}) as Data, bm = (b || {}) as Data;
      for (const d of new Set([...Object.keys(am), ...Object.keys(bm)])) if (!same(am[d], bm[d])) { if (bm[d] === undefined) delete m[d]; else m[d] = clone(bm[d]); }
      out.map = m;
    } else if (b === undefined) delete out[k];
    else out[k] = clone(b);
  }
  return out;
}

// ids of ledger lines that disappear (so a phone's old copy doesn't offer to "upload" them again)
export const goneIds = (prev: Data | null, next: Data | null) => {
  const ids = (d: Data | null) => new Set(((d?.entries as Data[]) || []).map(x => String(x.id)));
  const n = ids(next);
  return [...ids(prev)].filter(x => x !== 'undefined' && !n.has(x));
};
