# loom

A tilt-to-read card trick that runs as a static page (GitHub Pages).

The page opens as an endless loom of threads with nothing hidden in it. You secretly enter a card while "adjusting" the image and double-tap to lock it in, and the threads on screen quietly reweave themselves. Tilt the phone and look along it from the charger end, and they squash together into **THE CARD YOU CHOSE WAS**. Look from the side and they read **THE SEVEN OF HEARTS**, or whichever card the spectator chose.

## The routine

1. Open the page. The spectator can drag, zoom, spin and **Reweave** the threads. At this point it really is only a random loom; there is no message in it, however far they zoom.
2. A card is chosen.
3. Take the phone back and play with the image while you talk:
   - **Pinch out / in**: value up / down (A → 2 → … → K → A, wraps around)
   - **Twist** clockwise / anticlockwise: next / previous suit every 22.5°, so all four go by within a quarter turn (wraps around). You can stop at any angle; the picture stays where you leave it.

   Each step gives a haptic tick, and the faint indicator in the bottom-right corner shows the current card (e.g. `7♥`).
4. **Double-tap** to lock the card in. Whatever angle the picture is at, the message fades in upright and sized to fit the screen, and the indicator gets a thin underline. From now on pinching and twisting only move the picture; the card cannot change.
5. Tilt from the bottom edge: **THE CARD YOU CHOSE WAS**. Turn the phone and tilt from the left edge: **THE SEVEN OF HEARTS**.

Other controls: drag with one finger to pan. Once locked, double-tap again brings the message back to the centre of the screen. **Reweave** makes a new loom, clears the message and unlocks, ready for the next performance. The indicator keeps the last card, so you can count from it.

## Setup panel

**Long-press the `loom` wordmark** in the top-left corner (or open `…/#setup`, or press <kbd>S</kbd> on a computer) for:

- both phrases, and which edge each is read from (`{value}`, `{suit}`, and `|` for a line break)
- suit order (CHaSeD or SHoCkeD), pinch sensitivity, how far to twist per suit, gesture lock, haptics
- indicator style: `7♥`, a code (`no. 07·2`), dots, or off
- stretch, letter case (capitals by default, so every letter is the same height), letter thickness, layout, and theme
- for lowercase: how tall the tall parts of letters are, and how many loose threads
- whether the rest of the loom is filled in (on by default)
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

1. Each phrase is set in small, light capitals. Every letter is only a few percent of the block's width, and every letter is the same height, so a phrase is one even band.
2. The phrase is stretched about 24× in one direction only: phrase 1 vertically, phrase 2 horizontally (it is the same thing rotated 90°).
3. The stretched bodies of the letters (the x-height) form the dense block. Ascenders and descenders hang out of it as loose threads.
4. The two phrases are laid over each other and each runs the full length of the screen, so the stems of one cross the stems of the other like warp and weft.

Nothing else is distorted. Where a curved stroke turns horizontal (the tops and bottoms of O, C, S, D) the stretch makes it 24× thicker, while the upright stems stay thin. That produces the fat, tapered loops, and the crossbars of E, F, H and T become the short black blocks.

At a grazing angle (about 2–5° above the screen), foreshortening squashes the stretched phrase back into normal letters. Strokes running the other way shrink to hairlines from that angle, so the other phrase barely gets in the way. Look from the charger end to read phrase 1, and from the left edge to read phrase 2.

The font is Roboto (variable weight), bundled in `fonts/` under the SIL Open Font License, so the letters look the same on every device.

The message fills the whole screen. Phrase 1 runs the full width and is stretched down the screen; phrase 2 runs the full height and is stretched across it. Because capitals are all one height, each phrase covers the screen from edge to edge with nothing sticking out. A phrase that is too short to reach the far end is repeated along its line: on a phone the card phrase appears two or three times down the screen.

Lowercase is still available in setup. There the short letters make the band and the tall ones (h, d, t, p, q) stick out of it. Those tall parts are stretched only about a third as much, so they fit on screen, and some of their stems run on as loose threads.

The loom is made of the same thing as the message. It is page after page of stretched lettering, one phrase across each page and one down, except that the letters are nonsense. So the screen looks the same before and after you lock in; only the letters change. Pages are generated from a random seed when they come on screen, they tile in every direction, and they exist at every power-of-two scale.

Zooming is continuous. Two scales of lettering are always on screen, one twice the size of the other. As you zoom in, the larger one's threads spread apart and thin away (first through lighter cuts of the font, then by splitting into two fine lines along their edges), while the smaller one's start as hairlines between them and thicken. Each thread lives through two octaves of zoom, the amount of ink stays the same throughout, and there is no moment where one picture is swapped for another. When the message is woven in, the nonsense lettering under it is cleared, so nothing strikes through the words. At the same moment the loom is laid out afresh at the message's angle and scale, and from then on it keeps that scale instead of following the zoom. So when you zoom out afterwards, the message is surrounded by lettering exactly as dense as it is, and it is hard to pick out.

The loom is deliberately not a neat grid. Its two directions of lettering are laid out separately: lettering stretched down the image sits in columns, each shifted up or down by a random amount, and lettering stretched across sits in rows, each shifted sideways. Nothing lines up with the message either, so the loom's threads run up to it and stop wherever they happen to be. The effect is that you seem to have zoomed into exactly the right spot of a continuous fabric.

Lines that come from the words themselves:

- **Loose threads (lowercase only).** Some ascenders and descenders (the stems of b, d, h, k, l, t, p, q) run on past the block for a random distance. A taller l is still an l when tilted, so this does not hurt the reading. **Reweave** changes which stems run on and how far, and shifts the two phrases.
- **The letter k.** A font's k has diagonal arms that stretch into heavy wedges. It is redrawn as three threads (stem, arm, leg), each one stem wide.

The words are drawn as live, transformed canvas text, so they stay sharp at any zoom and are redrawn the moment the card changes.
