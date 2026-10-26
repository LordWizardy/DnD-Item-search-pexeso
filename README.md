# D&D Item Search Pexeso

A memory-card minigame for D&D sessions. Items are hidden on a board of face-down cards, and the party searches a site by flipping them. Matching pairs are loot, junk is nothing, and a monster starts a fight. The Dungeon Master runs it from the browser while the players call their rolls.

## How to play

This is a tool for the DM. Each player rolls Perception or Investigation against the site's DC and the DM enters the result.

- **Fail**: the player gets 1 try.
- **Success**: the player gets 2 tries.
- **Natural 20**: one special try that flips 4 cards at once. Every pair counts, and if a monster is revealed, it starts the encounter Surprised.
- **Natural 1**: the check fails with 1 try, and a hidden monster is shuffled into the board.

A try flips 2 cards:

- A **matching pair** goes to that player's loot.
- A **junk** pair is nothing.
- A **monster** opens the encounter screen and uses up the try. The DM picks one outcome:
  - **Victory**: the monster card is removed and the turn continues.
  - **Fled**: the card goes back face down, marked as a known danger, and the remaining tries are lost.
  - **Defeat**: the session ends and the loot is kept.

Play continues in rounds. Press **Next round** to start another. Optionally, a hidden monster can be added to the board each round. At the end, the summary can be copied as text, and the cards that were missed can be revealed. A DM peek toggle shows the board, and progress is autosaved.

## Setting up a board

Each site is a JSON config with a name, a DC, items, junk, monsters and options. Use the editor in the app to build one.

- **Rarity sets the default pairs**: common 4, uncommon 3, rare 2, very rare 1, legendary 1. Junk defaults to 3 pairs. Each item can override its pair count.
- **Monsters** are placed by count. A monster with count 2 adds two cards to the board.
- **Icons** can be an emoji, an uploaded image or an image URL. Uploaded images are downscaled to 256px.
- **Presets** can be saved, loaded, imported and exported as JSON. Browser storage is limited to about 5MB, so large custom sets may fail to save. Export them to keep a copy.

Example presets are in `presets/` and listed in `presets/index.json`.

## Running it

The bundled presets are loaded with `fetch`, which browsers block on `file://` pages. Use one of these:

- **Local server**: run `python3 -m http.server` in the project folder, then open http://localhost:8000.
- **GitHub Pages**: in the repository, go to Settings → Pages, choose "Deploy from a branch", select the branch, and use the root folder.

Opening `index.html` directly still works for custom boards that do not use the bundled presets.

## Development

- `node --test` runs the logic tests in `tests/`.
- `js/game.js` holds the pure game logic. It takes a state and returns a new state, with no DOM access.
- `js/app.js` holds the UI.
- `js/strings.js` holds all UI text, for translation.
- `presets/` holds the example site configs and their index.
