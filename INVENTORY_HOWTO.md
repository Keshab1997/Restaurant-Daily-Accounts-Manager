# Daily inventory — kivabe babohar korbo

Chhoto guide. Page ta 4 ta tab e bhaga: **Stock sheet · Items · Import sales · Corrections**.
Uporer **Stock date** (← Prev / Next) sob tab e kaj kore — age date select koro, tarpor kaj.

## Prothom bar (ekbarer kaj)

1. **Items** tab → item name, **Start date**, **Initial opening** (oi din er count) → *Add item*.
   - Masher shuru theke hisheb chai? **Start of month** button chapo (selected date er mash er 1 tarikh).
   - Ekta ekta kore add korte hobe — item add hoy sathe sathe save hoy (alada save button nei).
2. Item list e **Edit** diye name / start date / opening jekono somoy change korte paro.
   - Start date **pichone** (1 tarikh) nile opening sekhan theke carry forward hobe.
   - Start date **samne** sarate gele, jodi oi item er age saved purchase/damage/sale thake, app block korbe ar kon din gulote data ache bole debe.

## Rojer kaj — purchase & damage

1. Stock date select koro (aaj / kal).
2. **Stock sheet** tab e proti item er **Purchase** ar **Damage** box e number likho.
3. Save dui bhabe:
   - **Save all changes** (upore, header e) — je je row e edit korecho sob ek sathe save hoy. Rows jodi onek, ei ta use koro.
   - Table er bhitore proti row er **Save** — ekta row er jonno.
4. Draft: type kore save na korle oi row holud hoye thake ar *unsaved draft* banner dekhay. Reload korleo draft thake — pore save ba **Discard** korte paro.

Keyboard: **Enter** = Purchase → Damage → Save; **↑ / ↓** = row er moddhe upor-nich.

## Sale (POS report theke)

1. **Import sales** tab → **Report file** e `.xls` / `.xlsx` item report dao.
2. Prottek dish er pashe item select koro, ba *Ignore* (report e jei item er stock nei).
   - Ekbar map kore dile porer bar app nije mene ney.
3. **Preview totals** → number gulo miliye dekho → **Confirm sales import**.
   - Oi din er purono sale replace hoy, double hoy na.
4. Save hoye gele page nije **Stock sheet** e chole jabe, ar Sale column e number dekhbe.
5. Import tab e status line thake: *"Saved sales for 2026-11-23: 12 items, 486 pieces"*.

⚠️ Excel file ta browser e pora hoy, kothao upload hoy na. Reload korle file ar preview hariye jay — abar select korte hobe.

## Bhul hole — Corrections tab

- **Remove selected day's imported sales** — shudhu oi din er POS sale much jay.
- **Clear selected day's movements & sales** — oi din er purchase/damage/sale sob much jay (item, opening, mapping, onno din safe).
- Muchar age automatic **recovery snapshot** save hoy → **Restore** diye ferot paoa jay (reload er por o).

## Mone rakho

- **Opening** mane oi **start date** er count. Pore r change korte na chaile start date ekbar thik kore nao.
- Closing = Opening + Purchase − Sale − Damage. Closing negative = lal (stock shortage).
- Sale kokhono hate type kora jay na — sale shudhu import theke ashe. Keno? Sale item-wise POS report er data, hate dile milbe na.
- Save sob **Supabase** e jay; draft shudhu tomar browser e (localStorage).
