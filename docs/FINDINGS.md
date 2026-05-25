# INET App — Findings Backlog

Actionable list of bugs, performance work, and enhancement opportunities.
Prioritized by blast radius: **P0** = data loss / corruption, **P1** = wrong
behavior or measurable slowness, **P2** = UX / polish.

Every entry has **Where**, **Why it matters**, and **Fix**.

---

## P1 — Bugs / fragile logic

---

## P1 — Performance

---

## P2 — UX / polish

---

## P2 — Data quality

### Foreign-key fields stored as Data
- **Where**: `isdp_ibuy_owner`, `isdp_owner_ms2` store free-text owner names.
- **Fix**: Defer until owner list is stable; promote to a Link to a new
  "Huawei Owner Master" when ready.

---

## Roadmap (later)

- Owner Master + Link conversion for `isdp_ibuy_owner`.
- Cursor pagination for PO Dump and PIC Tracker (currently offset-based).
- `_batch_customer_activity_types` Redis cache: at current scale (< 100 users)
  the single SQL per page load is fine. Revisit if concurrent users grow past
  ~200 — at that point add a short-TTL cache with CIM hook invalidation.
