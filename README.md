# loom

A tilt-to-read card trick that runs as a static page (GitHub Pages).

The screen shows a random weave of threads. When you tilt the phone and look along it from the charger end, the threads squash together into **YOU WILL PICK**. Look from the side and they read **THE 7 OF HEARTS**, or whichever card the spectator chose. You enter the card in secret while you "adjust" the image.

## The routine

1. Open the page. The spectator can pinch, spin and **Reweave** the threads. It's a random pattern.
2. A card is chosen.
3. Take the phone back and play with the image while you talk:
   - **Pinch out / in**: value up / down (A → 2 → … → K → A, wraps around)
   - **Twist a quarter turn** clockwise / anticlockwise: next / previous suit (wraps around)

   Each step gives a haptic tick, and the faint indicator in the bottom-right corner shows the current card (e.g. `7♥`).
4. Let go. The image snaps square and the hidden message is rewoven for the new card.
5. Tilt from the bottom edge: **YOU WILL PICK**. Turn the phone and tilt from the right edge: **THE 7 OF HEARTS**.

Other controls: drag with one finger to pan, and double-tap to recentre (the card stays the same).

## Setup panel

**Long-press the `loom` wordmark** in the top-left corner (or open `…/#setup`, or press <kbd>S</kbd> on a computer) for:

- both phrases, and which edge each is read from (`{value}`, `{suit}`, and `|` for a line break)
- suit order (CHaSeD or SHoCkeD), pinch sensitivity, gesture lock, haptics
- indicator style: `7♥`, a code (`no. 07·2`), dots, or off
- stretch, letter thickness, letter style (solid words or woven threads), number of decoy threads, layout, and theme
- **live previews** that simulate the tilted view, so you can check the text reads before you perform

Settings are saved on the device.

On a computer: scroll changes the value, shift+scroll changes the suit, and the arrow keys step value and suit.

## Tips

- Add the page to your home screen so it opens full screen, without browser bars.
- Turn off auto-rotate, or leave "Keep weave fixed if the screen auto-rotates" switched on.
- Each phrase is stretched just enough to fill the square, so short phrases get less stretch and long ones more. **Stretch** sets the minimum. Raise it to hide the words better, or lower it so you don't have to tilt as far.
- The **overlap** layout (the default) is the classic construction. The **split** layout gives each phrase its own half instead.

## Hosting on GitHub Pages

It is plain static HTML, CSS and JS with no build step. In the repository go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, pick the branch and `/ (root)`, and save. The site appears at `https://<user>.github.io/loom/`.

To try it locally, run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## How it works

It uses the classic tilt-to-read construction:

1. Phrase 1 is set in a thin condensed sans across the square, then stretched vertically until it fills the square. That is about 8–12×, depending on the phrase's length. The thin weight keeps the letter stems as fine as the decoy threads.
2. Phrase 2 gets the same treatment and is then rotated 90°, so it is stretched horizontally.
3. The two are laid over each other in the same square.

At a grazing angle, foreshortening squashes the stretched phrase back into normal letters. Strokes running the other way shrink to hairlines from that angle, so the other phrase barely gets in the way. Look from the charger end to read phrase 1, and from the right edge to read phrase 2.

The font is Roboto Condensed (variable weight), bundled in `fonts/` under the SIL Open Font License, so the letters look the same on every device.

Decoy warp and weft threads, diagonals and fringe make it look like a woven cloth. The words are drawn as live, transformed canvas text, so they stay sharp at any zoom and are redrawn the moment the card changes.
