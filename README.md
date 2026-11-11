# loom

A tilt-to-read card trick that runs as a static page (GitHub Pages).

The page opens as an endless loom of threads with nothing hidden in it. You secretly enter a card while "adjusting" the image and double-tap to lock it in, and a patch of the loom quietly reweaves itself in the middle of the screen. Tilt the phone and look along it from the charger end, and that patch squashes together into **the card you chose was**. Look from the side and it reads **the seven of hearts**, or whichever card the spectator chose.

## The routine

1. Open the page. The spectator can drag, zoom, spin and **Reweave** the threads. At this point it really is only a random loom; there is no message in it, however far they zoom.
2. A card is chosen.
3. Take the phone back and play with the image while you talk:
   - **Pinch out / in**: value up / down (A → 2 → … → K → A, wraps around)
   - **Twist a quarter turn** clockwise / anticlockwise: next / previous suit (wraps around)

   Each step gives a haptic tick, and the faint indicator in the bottom-right corner shows the current card (e.g. `7♥`).
4. **Double-tap** to lock the card in. The message fades in at the centre of the screen, upright and sized to fit, and the indicator gets a thin underline. From now on pinching and twisting only move the picture; the card cannot change.
5. Tilt from the bottom edge: **the card you chose was**. Turn the phone and tilt from the left edge: **the seven of hearts**.

Other controls: drag with one finger to pan. Once locked, double-tap again brings the message back to the centre of the screen. **Reweave** makes a new loom, clears the message and unlocks, ready for the next performance. The indicator keeps the last card, so you can count from it.

## Setup panel

**Long-press the `loom` wordmark** in the top-left corner (or open `…/#setup`, or press <kbd>S</kbd> on a computer) for:

- both phrases, and which edge each is read from (`{value}`, `{suit}`, and `|` for a line break)
- suit order (CHaSeD or SHoCkeD), pinch sensitivity, gesture lock, haptics
- indicator style: `7♥`, a code (`no. 07·2`), dots, or off
- stretch, letter case, letter thickness, how many loose threads and loom threads, layout, and theme
- when the message is woven in: on lock-in (the default), as soon as a card is input, or from the start
- **live previews** that simulate the tilted view, so you can check the text reads before you perform

Settings are saved on the device.

On a computer: scroll changes the value, shift+scroll changes the suit, and the arrow keys step value and suit.

## Tips

- Add the page to your home screen so it opens full screen, without browser bars.
- Turn off auto-rotate, or leave "Keep weave fixed if the screen auto-rotates" switched on.
- **Stretch** (default 24×) sets how squashed the words are. Both phrases always fill the same rectangle, so more stretch means narrower letters spaced further apart, and a flatter tilt to read them.
- Longer phrases make a denser, more convincing mesh. Card values are spelled out ("seven") by default for that reason.
- The **overlap** layout (the default) is the classic construction. The **split** layout gives each phrase its own half instead.

## Hosting on GitHub Pages

It is plain static HTML, CSS and JS with no build step. In the repository go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, pick the branch and `/ (root)`, and save. The site appears at `https://<user>.github.io/loom/`.

To try it locally, run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## How it works

It copies how the classic tilt-to-read images are built:

1. Each phrase is set in small, light, lowercase type. Every letter is only a few percent of the block's width.
2. The phrase is stretched about 24× in one direction only: phrase 1 vertically, phrase 2 horizontally (it is the same thing rotated 90°).
3. The stretched bodies of the letters (the x-height) form the dense block. Ascenders and descenders hang out of it as loose threads.
4. The two phrases fill the same rectangle: each is letter-spaced to reach the far side, so the stems of one cross the stems of the other everywhere, like warp and weft.

Nothing else is distorted. Where a curved stroke turns horizontal (the tops and bottoms of n, o, e, a, s) the stretch makes it 24× thicker, while the upright stems stay thin. That is what produces the fat, tapered loops at the top and bottom of each letter. Lowercase matters: capitals are mostly straight stems and bars, which stretch into obvious rectangles.

At a grazing angle (about 2–5° above the screen), foreshortening squashes the stretched phrase back into normal letters. Strokes running the other way shrink to hairlines from that angle, so the other phrase barely gets in the way. Look from the charger end to read phrase 1, and from the left edge to read phrase 2.

The font is Roboto (variable weight), bundled in `fonts/` under the SIL Open Font License, so the letters look the same on every device.

The loom around the words is generated from a random seed, on the fly, for whatever part of it is on screen. It is drawn with the same shapes a stretched letter has: long stems, pairs of stems joined by a fat tapered arch, and short thick bars. It spells nothing, and it is about as dense as the message, so the message does not stand out as a darker patch.

The loom is self-similar. Threads live on octaves, each with twice as many threads as the last. At any zoom the octaves up to that zoom are drawn and the next one is fading in, while thread thickness and the size of arches and bars stay fixed on screen. Zooming in therefore keeps revealing new threads of the same size between the old ones, and there are no edges to reach. A loom thread is cleared only where it would read as a letter stem when tilted, which is inside the phrase stretched along it. Everywhere else the threads run right up to the block.

Lines that come from the words themselves:

- **Loose threads.** Some ascenders and descenders (the stems of b, d, h, k, l, t, p, q) run on past the block for a random distance. A taller l is still an l when tilted, so this does not hurt the reading. **Reweave** changes which stems run on and how far, and shifts the two phrases.
- **The letter k.** A font's k has diagonal arms that stretch into heavy wedges. It is redrawn as three threads (stem, arm, leg), each one stem wide.

The words are drawn as live, transformed canvas text, so they stay sharp at any zoom and are redrawn the moment the card changes.
