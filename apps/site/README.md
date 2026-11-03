# Taxly site

The landing page: an animated ledger hero and a feature grid, built with the
stageshow kit copied into `src/kit` (MIT, © Benji Taylor; see `src/kit/LICENSE`).

```sh
cd apps/site
npm install
npm run dev     # http://127.0.0.1:1430
npm run build   # static output in dist/
```

- `src/demos/LedgerHero.tsx`: the hero. Plays once in view and holds the result; "เล่นอีกครั้ง" replays it.
- `src/demos/Features.tsx`: five tiles. Each picture is its own Stage at 1:1 and plays one beat as it scrolls in.
- `src/demos/look.css`: Taxly's tokens (from `apps/desktop/src/styles.css` and `shell.css`) mapped onto the kit.

Every figure on the page is illustrative, not taken from a real account.
