#!/usr/bin/env python3
"""Insert one delivery challan (one গাড়ি) into the live Khata database.

Usage:
  python3 insert.py challan.json            # dry run: prints the plan, writes nothing
  python3 insert.py challan.json --write    # really writes (only after the owner said "yes")

challan.json:
{
  "date": "2026-10-20",                 # stock day (YYYY-MM-DD)
  "car": "45",                          # গাড়ি নং (saved in Bangla digits)
  "vno": "539279",                      # চালান নং
  "company": "Karnafully Steel Mills",  # matched by name; created if missing
  "company_address": "",                # only used when the company is new
  "time": "15:30",                      # optional, Dhaka time (shown as the entry time)
  "rate": 0,                            # দর per টন (0 = not known yet)
  "lines": [                            # in the same order as the challan
    {"marka": "kK", "h": 90, "w": 914, "kg": 7940, "ci": "SFG.ANN.CRC.900X914", "coil": ""}
  ]
}
A size that is missing in that মার্কা is added (asked about first). A চালান নং already on that day stops the script.
"""
import json, sys, time, random, string, datetime, urllib.request

API = "https://erp-psi-woad.vercel.app/api/db"
BN = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def q(body):
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def uid(prefix="m"):
    return prefix + "".join(random.choices(string.ascii_lowercase + string.digits, k=11))


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    write = "--write" in sys.argv
    date, car, vno = spec["date"], str(spec["car"]).translate(BN), str(spec["vno"])
    rate = float(spec.get("rate") or 0)
    hh, mm = (spec.get("time") or "12:00").split(":")
    # Dhaka = UTC+6
    ts0 = int(datetime.datetime.fromisoformat(f"{date}T{int(hh):02d}:{int(mm):02d}:00+06:00").timestamp() * 1000)

    cats = q({"op": "get", "path": "settings/cats"})["data"]
    markas = {m["id"]: m for m in cats["list"]}
    new_sizes, lines = [], []
    for ln in spec["lines"]:
        m = markas.get(ln["marka"])
        if not m:
            sys.exit(f"unknown মার্কা id {ln['marka']!r} — known: " + ", ".join(f"{k}={v['name']}" for k, v in markas.items()))
        h, w = float(ln["h"]), int(ln["w"])
        hit = next((i for i in m["items"] if float(i.get("h", 0)) == h and int(i.get("w", 0)) == w), None)
        if not hit:
            hit = {"id": uid("mvgk"), "h": ln["h"], "w": w}
            m["items"].append(hit)
            new_sizes.append(f"{m['name']} {ln['h']} × {w}")
        lines.append({**ln, "item": hit["id"], "mname": m["name"]})

    cos = [d["data"] for d in q({"op": "list", "col": "companies"})["docs"]]
    co = next((c for c in cos if c["name"].strip().lower() == spec["company"].strip().lower()), None)
    new_co = co is None
    if new_co:
        co = {"id": uid(), "name": spec["company"], "opening": 0, "created": ts0, "entries": []}
        if spec.get("company_address"):
            co["address"] = spec["company_address"]

    got = q({"op": "get", "path": f"days/{date}"})
    day = got["data"] if got.get("exists") else {"id": date, "opening": 0, "due": 0, "entries": []}
    if any(str(e.get("vno")) == vno for e in day.get("entries", [])):
        sys.exit(f"চালান {vno} is already on {date} — not inserting twice.")

    total = 0
    for i, ln in enumerate(lines):
        ce, ts, kg = uid(), ts0 + i, int(ln["kg"])
        total += kg
        row = {"kg": kg, "car": car, "ts": ts, "cat": ln["marka"], "item": ln["item"], "vno": vno, "co": co["id"], "ce": ce}
        if ln.get("ci"): row["ci"] = ln["ci"]
        if ln.get("coil"): row["coil"] = str(ln["coil"])
        day.setdefault("entries", []).append(row)
        co.setdefault("entries", []).append({"id": ce, "ts": ts, "type": "inv", "date": date, "kg": kg, "mili": 0,
            "size": ln["h"], "len": int(ln["w"]), "item": ln["mname"], "mt": "", "rate": rate,
            "amount": round(kg / 1000 * rate), "vno": vno, "car": car, "fromStock": True})

    print(f"{date} · গাড়ি {car} · {co['name']}{' (NEW company)' if new_co else ''} · চালান {vno} · দর {rate:g}")
    for ln in lines:
        print(f"   {ln['mname']}  {ln['h']} × {ln['w']}  {ln['kg']:>7,} কেজি  {ln.get('ci', '')}")
    print(f"   total {total:,} কেজি")
    if new_sizes:
        print("   NEW sizes:", "; ".join(new_sizes))
    if not write:
        print("dry run — nothing written (add --write)")
        return

    if new_sizes:
        n0 = sum(len(m.get("items", [])) for m in cats["list"])
        q({"op": "set", "path": "settings/cats", "data": cats})
        n1 = sum(len(m.get("items", [])) for m in q({"op": "get", "path": "settings/cats"})["data"]["list"])
        assert n1 == n0, f"size count changed unexpectedly {n0} → {n1}"
    q({"op": "set", "path": f"days/{date}", "data": day})
    q({"op": "set", "path": f"companies/{co['id']}", "data": co})
    d = q({"op": "get", "path": f"days/{date}"})["data"]
    cars = sorted({e.get("car") for e in d["entries"] if e.get("car")})
    print(f"written ✓  {date} now: {len(cars)} গাড়ি ({', '.join(cars)}) · {len(d['entries'])}টা মাল · {sum(e['kg'] for e in d['entries']):,} কেজি")


if __name__ == "__main__":
    main()
