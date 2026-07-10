# SMA & The Industry — Knowledge Brief
*Synthesis of the full research corpus · 2026-07-10 · companion docs in project: `research/sma-company-profile.md`, `research/au-industry-map.md`, `research/customers-knowledge-domain.md` (all citation-dense, ingestion-ready)*

## The company in one paragraph

Sewing Machines Australia Pty Ltd (ABN 43 115 795 198, incorporated Aug 2005, GST-registered) is a Brisbane industrial sewing machine dealer operating from Clear Mountain QLD (mail: PO Box 178, Albany Creek 4035), founded by **Anthony Pascoe** — described on their site as "one of Australia's leading Sewing Machine Technicians," active in the trade since at least 1996. Small team (likely high-single-digits to low teens: Anthony + Carol in customer service, Ashley on webshop/parts, Jake field tech, a trainee technician, plus service/parts/office roles), estimated revenue < A$5M, ~12,900 monthly site visits. Industrial/commercial sales only (services domestic machines too), shipping Australia-wide + NZ, with customers from Sealy and Sleepmaker to Combat Clothing (defence, ~75 machines, 12-year relationship), Cook Medical's stent production line, correctional-centre textile shops, sailmakers, shade-sail companies and the equine industry. Claims 80% of business is referrals.

## What makes SMA distinctive (product-relevant)

1. **The SMA house brand** — they buy proven machines (e.g. the K6 is a reworked Typical TW1-2B), upgrade and re-engineer them in-house for Australian conditions, pre-set them for the customer's exact fabric/thread before dispatch, and back them with a doubled 2-year warranty. **The knowledge of what they change and why lives only in Tony's head — highest-value teach-session content, zero public availability.**
2. **They already sell knowledge**: the "Virtual Technician" service ($95+GST video sessions for basics/quotes/repair coaching) proves customers pay for remote expertise. The Brain is Virtual Technician made instant and scalable — and its natural triage front-end.
3. **Deep niche coverage competitors lack**: horse-rug machinery, carpet overlockers, Buraschi net/rope machines, mattress tape-edge parts — plus a parts store spanning 37 brands organized brand→model→part.
4. **A real (if dated) content moat already**: Technical Help articles, a 14-category video library, testimonials, newsletter. All of it is seed corpus for the Brain — and the Joomla/VirtueMart site is scrapable.
5. **Warranty/policy specifics** the bot must know cold: 12-mo goods / 6-mo bag closers & cutters / 3-mo second-hand / 7-day serviced-work warranty; onsite warranty within 30km of Brisbane CBD, travel billed in 15-min increments beyond; 30% deposit, balance before dispatch; leasing, layby, interest-free options; 30-day trade accounts.

## The industry in one paragraph

Australia's industrial sewing machine market (~106K units, ~US$91M/yr, IndexBox modelled) is structured around exclusive import agencies — Juki→Elizabeth Machines (Melbourne, since 1960), Dürkopp Adler→DASEC, Typical→Camsew, Highlead→Highlead Aus, Handi Quilter→Blessington — with an open-import field (Jack, Siruba, Zoje…) where dealers like SMA compete on curation, setup and service. The traditional garment-manufacturing customer base is structurally shrinking (Australian fashion manufacturing lost 18% of its value in five years; only ~6,100 sewing machinists remain, −400/yr), while demand migrates to upholstery, motor/marine trimming, canvas & shade sails, leather, horse rugs, mattresses and packaging — buoyed by a booming caravan/RV sector (23,963 RVs built in 2025) and a $10B+ marine industry. A 2026 National Manufacturing Strategy (AFC + R.M.Williams) is pushing reshoring. Competitors of record: Elizabeth Machines, DASEC, QLD Sewing Machines (Loganholme — advertises 24/7 phone tech support), Camsew, MJC, Peter Industrial, Sewing Machine City, SMW Penrith, Know-How, Kameo (bag closing), Marfar (parts), Sun Valley (Cowboy leather).

## The strategic fact the whole project stands on

**Australia has ~250 qualified sewing machine mechanics left (ANZSCO 323215), median age 57, 38.7% over 55, and no dedicated apprenticeship pathway.** The trade's expertise is literally dying out, dealers everywhere carry the same phone/email support burden ("which machine do I need?", "why is it skipping stitches?"), and buyers who import direct from China still come to dealers for the knowledge. Meanwhile **no industrial-sewing dealer AI assistant exists anywhere in the world** — the closest thing is a US$2.99/mo hobbyist chatbot. Every ingredient (engineer's manuals, parts books, thread/needle charts, forum lore) exists scattered; nobody has assembled it. Tony's Brain would be first, grounded in a 30-year practitioner's knowledge no scraper can reach.

## What the Brain must know (knowledge taxonomy, seedable now)

- **Products & catalog** (scrape): machines by category/industry, parts by brand→model, accessories, second-hand flow, prices ex-GST.
- **SMA policies** (teach sessions, week 1): warranties, freight, deposits, leasing/layby, trade accounts, service booking, Virtual Technician, onsite travel rules.
- **Machine selection logic** (research corpus + Tony): segment → machine class → feed type → needle system → thread. The corpus doc has the full matrix (upholstery→walking foot 135x17 V69-V138; sails→long-arm zigzag; saddlery→441-class system 794 V138-V415; etc.).
- **Troubleshooting trees** (research corpus + Tony): skipped stitches, breakage, birdnesting, puckering, feeding, timing — per machine class, eventually per model.
- **Trade fundamentals** (research corpus, ingestion-ready): stitch classes (ISO 4915), needle systems, thread numbering (Tex/Tkt/V), feed types, clutch vs servo, service intervals, parts anatomy.
- **Industry context** (research corpus): who distributes what, market trends, customer-segment profiles — for staff answering "can you even get X in Australia?"
- **Tony's opinions** (teach mode, forever): what he'd actually recommend, what he refuses to sell, what breaks, what's overpriced junk, negotiation/pricing wisdom. **This layer is the moat.**

## Verification status & caveats

Verified against primary sources: ABN/registration (ABR), premises (multiple directories + ABR postcode), founder & history (SMA site + testimonial cross-refs), product/brand range (site navigation), policies (site Terms), technician-shortage stats (Jobs & Skills Australia), distributor exclusivities (distributor sites). Model-estimate caveats: revenue (<$5M, broker models), employee count (1–10 vs 11–50 conflict), IndexBox market figures (modelled, internally inconsistent CAGRs). Unverifiable without paid extract: ASIC directors. Possibly stale: site JOBS page, listed hours. Google-review volume unknown (robots-blocked). Full uncertainty register in `research/sma-company-profile.md` §9.

## Implications for the build (carried into the spec)

1. Seed the Brain from three layers on day 1: catalog scrape + SMA site knowledge content + our research corpus (these three docs).
2. Prioritise teach-mode coverage where knowledge is unique-to-Tony: SMA-brand modifications, policies, selection opinions, per-model quirks.
3. The phone-call co-pilot mode maps to a documented industry reality (dealers' 24/7 support burden) — staff need instant, glanceable answers with product links mid-call.
4. Phase 2 public bot competes with… nothing. First-mover in a global gap, with the public/internal visibility flag protecting Tony's private layer.
5. The bot must speak the trade's language precisely (needle systems, Tex sizes, model numbers) — hybrid retrieval + STT custom vocabulary are load-bearing design choices, not nice-to-haves.
