# Focus icon alternatives

Issue [#107](https://github.com/xpcoffee/modl/issues/107) asks for replacements for the coffee cup on the focus toggle in the search menu. Each SVG here is one candidate for `FocusIcon` in `packages/app/src/panels/SearchMenu.tsx`.

**G, orbit, is the chosen icon** and now ships in `FocusIcon`. The other seven stay here as the record of the round, and as a starting point if the icon is revisited.

Every candidate uses a 24×24 viewBox and filled paths, so it drops into the menu unchanged: `.search-menu__icon` sets the size (16px) and `fill: currentcolor`.

The candidates read the board as a field, following [decision 010](../../decisions/010-gravity-wave-art-direction.md): a mass, a ring of influence, waves through the dot grid.

| file | candidate | reads as |
| --- | --- | --- |
| `a-gravity-well.svg` | Gravity well | A mass in the field with its ring of influence. |
| `b-field-lensing.svg` | Field lensing | Grid dots held around a mass, the board's own medium. |
| `c-reticle-lock.svg` | Reticle lock | A viewfinder closed on one target. |
| `d-aperture.svg` | Aperture | A stopped-down lens: less light, one subject. |
| `e-pulse.svg` | Pulse | A light pulse leaving one point, both ways. |
| `f-warp-in.svg` | Warp in | The field closing in on what is left. |
| `g-orbit.svg` | Orbit | One body and what stays bound to it. |
| `h-collapse.svg` | Collapse | Four sides warping in on a centre. |

`contact-sheet.html` renders all eight at 16px, 24px, and 64px, and inside the toggle button in both states, against the board's dark background. Open it in a browser to compare; `contact-sheet.png` is the rendered version posted on the issue.
