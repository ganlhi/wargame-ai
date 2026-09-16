# Wargame AI

## Overview

This project is an AI opponent for tabletop naval wargames in the age of sail. The physical table is the game; the app is a companion that plays one side's ships. The player describes what is on the table — the wind, the terrain, every ship's heading and where it lies relative to a reference ship — and asks the AI what its ships do. The AI answers with a movement plan for each of its ships, which the player carries out on the table by hand, then resolves fire, damage and boarding with the rulebook and dice as usual. Next turn the player describes the table again.

Naval wargames suit this well: the traversable terrain is flat, and every piece of non-open terrain is impassable.

## What the app does not do

- It does **not** simulate the game. It keeps no turn counter, no log, and no running record of where anything is: every turn the player re-enters what the table shows. The positions it holds are only what was last typed in.
- It does **not** move the player's ships, and it does not move its own either. Once orders are revealed the ships stay drawn where they were entered, with the planned track laid over them, until the player types in where they actually ended up.
- It does **not** decide when to fire. The AI uses its knowledge of every ship's guns to choose *where to be* — a broadside bearing at close range is what most of its manoeuvring is for — but which arc fires, at what, and with what result is all resolved at the table.

## The table is infinite

The game table has **no edges and no fixed dimensions**. Ships may sail arbitrarily far in any direction; nothing is ever clamped, and the movement algorithm has no notion of a boundary. When the action drifts off one side of the physical table, everything is simply slid back across it.

### The origin ship

With no frame to measure from, **the first ship placed in a game becomes the origin**, and every other ship and terrain piece is placed relative to it. Only a ship can be the origin — a ship is what a player holds a ruler against — so **no terrain can be placed until at least one ship is on the table**, and the last ship cannot be removed while any terrain remains. The origin can be re-pointed at any other ship from that ship's panel; it is only reassigned automatically when the origin ship is deleted. A destroyed or surrendered ship is still a model on the table and stays a perfectly good reference point.

### Bearings

A position is entered and shown as **a compass direction and a distance from the origin ship**, the way a player reads it across the table: `420 mm NNW`. Directions are the **16 points of the compass rose** (N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW) — deliberately coarse, since a position eyeballed across a table is not accurate to a degree — and distances are whole millimetres. The origin ship itself simply reads *origin*. Ship headings and the wind still use the finer 32-point compass the movement rules are written in.

Each entity has a **reference point** that its bearing is measured to:

- **ships**: the centre of the base;
- **terrain**: the centre of its bounding box, which for the primitives the app uses is the centre of the shape.

Bearings are converted to and from an internal world frame (millimetres, +x = East, +y = South) that the AI does its geometry in. That frame is never shown; a position typed as a bearing reads back as the same bearing.

## The rulebook's charts

Nothing about how fast a ship sails or how far her guns carry is typed in. Those figures are the rulebook's, transcribed from the binder into `src/data/binder.ts` and read at run time:

- **Sailing speeds and drift** come from the sailing charts, by the ship's **type**, the **wind strength** and the game's **scale**. Several types share a row — a 1st and a 2nd rate sail alike — so a type maps to a chart category rather than being one.
- **Turning points** come from the movement chart, by ship type alone. A 1st rate turns 3 points a turn where a cutter turns 10, which is what separates types the sailing charts rate together.
- **Gun ranges** come from the range charts, by the **gun type** and the game's scale.

The charts are printed in two units and held in one: ranges are given in centimetres and stored as millimetres; speeds are already millimetres for a whole game turn.

So a ship is described by what she *is*, and everything that follows is looked up. The looked-up values are kept on the unit — the movement and AI code reads `speedProfile`, `driftSpeed`, `maxTurnPoints` and each gun's `ranges` — but they are a **cache, not a setting**: `resolveUnit` rewrites them from the ship's type and the game's conditions on every write, along with her **attitude** (her point of sail, which follows from her heading and the wind), so nothing downstream ever has to wonder whether a figure is stale. A ship imported from the library into a game at another scale is re-read into that scale automatically.

## Setting up a game

- The player creates a game, giving it a **scale** — 1/700 or 1/1200. Every distance in the game is read from the charts against it, so it is settled before anything is placed and cannot change once ships are on the table.
- The wind has a **direction** and a **strength**. The direction is entered and shown as the point of the 32-point compass the wind blows **toward** — the way the arrow on the map reads — and stored as the point it blows *from*, which is what the attitude rules work in. The strength is one of slight air, light breeze, gentle breeze, moderate breeze, fresh breeze or gale. Both are set from the battlefield and are expected to change as the game goes on; the wind is one of the things the player re-enters each turn.
- **Ships** are described by:
    - side (player or AI)
    - name
    - heading, on the 32-point compass
    - position, as a bearing from the origin ship (the first ship has none — she *is* the origin)
    - her **type**, from the binder's list — 1st to 6th rates, large frigates, sloops, xebecs, brigs, snows, schooners, cutters and the rest. Her speed on every point of sail, her drift and how many points she may turn all follow from it; the form shows what the charts give her, read-only. In irons is never among the speeds: head to wind a ship carries no way of her own and drifts instead.
    - rig: square (the default) or fore & aft, which shifts the in-irons/beating boundary
    - base footprint (width and length)
    - a **sail set**, entered as a whole percentage — 100% by default, less for a ship shortened down, more for one under full sail — and applied as the decimal it stands for, so 90% multiplies her speeds by 0.9. Percentages are typed rather than decimals because a field that reparses every keystroke cannot hold a half-typed decimal.
    - her **gun layout**: per arc (bow, stern, port, starboard), a list of gun types out of the charts and how many of each. **Every ship carries one, player ships included**: the AI judges how dangerous a player ship is, and how far to keep from her, by her guns, so leaving them off would leave it guessing. Where a ship genuinely has no guns entered, the AI falls back on its own ranges.
    - for an AI ship, her **style**: aggressive, cautious or defensive (see below).
    - her **status**: active, immobilised (may not move — a ship grappled at the table is marked so), destroyed or surrendered (may do nothing).
- **Terrain** pieces are simplified primitives rather than traced outlines: a shape (circle, ellipse or rectangle), its size (diameter, or width E–W and length N–S), its rotation for ellipses and rectangles, and the bearing of its centre from the origin ship.

### Saved ships

A ship's settings can be **saved under a name and imported into another ship** instead of being typed again. A saved ship holds what is the ship's own whichever game she is in — her type, rig, sail set, base footprint and gun layout — and none of her game state: position, heading, side, status and AI style are left to the unit. Nor does she hold a single speed or range: those belong to the scale and weather of whatever game she is fought in, and are read from the charts when she is imported into one. The library lives outside any game, in its own local storage entry (mirrored to Drive when sync is on). It is reached in two places. On the **home page**, a *Saved Ships* list under the games shows every ship with a one-line summary; a ship can be added there from scratch, and tapping one opens it for editing (name included, though two saved ships may not share a name) or deletion. In the **unit form**, *Save these settings* names the current form's settings (saving under an existing name, ignoring case, replaces that ship), and a dropdown imports one, which fills the form and takes the saved name as the ship's when the name field is blank. Importing gives every arc and gun profile fresh ids so two ships from one template stay editable independently. Both forms edit a ship's settings through one shared set of fields, guns included, so a class looks the same wherever it is met.

## The turn

There is no separate setup phase: the table is editable at all times, and a game is simply a table that gets re-described every turn. A turn goes:

1. **The player updates the table.** Wind direction and strength; every ship's heading and bearing from the origin ship; every terrain piece's bearing; any change of status (a ship immobilised, struck or sunk since last time). Ships can be added or removed at any point. A ships-and-terrain list under the map gives every entity's current reading and opens its form, so a whole turn's update is a pass down the list. Nothing is carried forward from the previous turn except what was typed.
2. **Reveal orders.** The AI lays a movement plan for each of its ships that can act. Each plan is drawn on the map as a track and listed on an order card.
3. **The player carries the orders out** on the physical table, then resolves fire, damage, grappling, boarding and everything else with the rulebook. None of that is tracked by the app; what matters to the AI is recorded by setting a ship's status.
4. **Next turn.** The orders are cleared and the app is back at step 1, showing the ships where they were last entered.

Revealed orders are a snapshot of the table as it was described. Changing anything the AI planned against — a position, a heading, the wind, a terrain piece, a ship's style or settings, adding or removing a ship — discards them and returns to step 1, where *Reveal orders* lays them again. Marking status does not: that is bookkeeping the player does while resolving the very turn the orders belong to.

### What the AI remembers

The app keeps no history of the game, but the movement rules refer to a ship's previous turn, so when *Next turn* is pressed the AI records three things about each of its own ships from the order it just gave — and nothing about any other ship:

- how far she **sailed**, which sets next turn's minimum move (half of it);
- what her **attitude was as the orders were given**, which with her attitude now decides whether she may tack (a tack needs a full turn spent beating);
- the **direction of a tack under way**, since a ship lying head to wind could have arrived there from either tack and the geometry alone cannot say which way she should keep swinging.

These are the AI's recollection of its own intentions, not a record of the table. The table itself is whatever the player next types in: if a ship's re-entered heading says she is no longer in irons, the tack is over whatever the AI expected.

## Movement rules

Units have a maximum and minimum movement range. Between these boundaries, they can move any distance, knowing that the next turn's min distance will be half of what they have moved this time. On a ship's very first turn there is no previous move to halve, so its minimum is **half of its maximum**.

A ship's maximum for a point of sail is the charts' figure for her type in this weather and scale, scaled by her sail set, so that one number moves both ends of the range at once — a ship under full sail must commit to more way, not just be allowed more.

The minimum is measured against the ship's base maximum for its point of sail, so it is a fixed number for the turn. The maximum, by contrast, drops 5% per turn point spent (see below) — so a plan with more than 10 turn points pushes the ceiling below the floor, which simply means that plan is not legal.

The selected movement distance is split as evenly as possible in 5 chunks. The ship is allowed to turn port or starboard up to two times during the movement phase, at the end of a chunk. For instance it can move, turn, move, move, turn, move, move.

Turning is done in "points", knowing that a full 360 degrees circle is divided into 32 points (so 1 point = 11.25 degrees). Each ship has a maximum number of points per game round it can turn, which the movement chart gives by her type.

A turn is made the way the model is turned on the table: the ship **pivots about the rear corner of its base on the side it turns to** — the stern-port corner for a turn to port, the stern-starboard corner for a turn to starboard. That corner stays put and the rest of the base swings round it, so a turn shifts the ship's centre sideways and a little forward as well as changing its heading. This applies to every turn, including the swings of a declared tack. The displacement of a pivot is not distance sailed: it does not count toward the next turn's minimum move. For instance a 4th rate ship can turn 6 points, so it could, during its movement phase, turn 2 points then 4 points, for a total of 6 points; or turn 6 points in one go. It can also turn less than the maximum allowed.

Each turn point reduces the max speed by 5%. For instance, if a ship is able to move maximum 100mm straight ahead, without turning, if it decides to turn 5 points (in one go or split into two turns), then its maximum speed becomes 75mm (to be split in 5 chunks of 15mm).

At the end of a movement phase, the new orientation of the ship, in relation to the wind, will dictate how fast it will be able to move next time. If we number the points in relation to the ship's bow from 0 (ship's bow) to 16 (ship's stern), symmetrically left and right (so 90 degrees left and right are both numbered 8), we can qualify the following attitudes, depending from which direction the wind is blowing:

- points 0 to 5: the ship is "in irons", meaning the wind comes from ahead
- points 6 to 7: the ship is "beating"
- points 8 to 9: the ship is "reaching"
- points 10 to 13: the ship is "quarter reaching"
- points 14 to 16: the ship is "running"

Exception: for ships flagged as "Fore & Aft Rigged", the first two ranges change as follows:

- points 0 to 4: in irons
- points 5 to 7: beating

For most ships, the best to worst attitudes are as follows: quarter reaching, running, reaching, beating, in irons.

## Tacking

A beating ship that turns further into the wind — even by one point — goes into irons. It may do that, but only by declaring a **tack**, which commits it to a fixed procedure:

- **Eligibility.** A tack may only be declared if the previous turn was spent *entirely* beating: beating as that turn began and still beating as it ended.
- **Direction.** The ship swings toward whichever bow the wind is on, and **must keep turning that same way** every turn until the tack completes. The direction is remembered rather than re-derived: a ship lying head to wind could have arrived there from either tack, so the geometry alone cannot say which way it should carry on.
- **No way on.** From the moment the tack is declared — including that first turn, when the ship is technically still beating — it makes no progress under sail. It drifts straight downwind instead, by its drift speed, for as long as the tack lasts.
- **Completion.** The tack ends the moment the ship is beating again on the *other* side of the wind. It never swings past that point into a reach: the swing each turn is capped at whatever brings it onto the new tack. A tack resolves only at a turn boundary, so a ship that comes round part-way through a turn still drifts out the remainder of it and gathers way again the following turn.
- **No choice mid-tack.** While the tack is under way, the ship has no other order available.

Because turning up into the wind requires this procedure, an ordinary movement order that would leave a ship in irons is not legal and is never offered. A ship whose entered heading puts her in irons without a tack declared is put into the procedure regardless, so she always has a defined way out.

The player's own ships are never given orders by the app, so tacking only concerns the AI's; the player tacks their ships at the table.

## Guns and range bands

An arc's armament is a list of **gun profiles** rather than a single range and gun count — a broadside is rarely uniform, with long guns on the gun deck and carronades above, each reaching its own distances. A profile is a gun type and a number of guns; the outer edge of five bands — **point blank, close, medium, long, extreme** — is read from the range charts for that type at the game's scale. A shot falls in the first band whose distance it is still within, and beyond extreme the guns do not reach at all.

Distance costs accuracy, and the bands carry a to-hit modifier for it: point blank ×1.6, close ×1, medium ×0.54, long ×0.4, extreme ×0.07. Point blank is the one band the charts give no multiplier for — there every hit is automatic, where a close-range broadside still lands only the dice roll's share of itself, so muzzle to muzzle is worth about half again as much as close. So what a shot is really worth is its **effective weight of metal** — each gun counted at its own band's modifier. That, not a raw count of guns, is what the AI weighs every position by, and it is what makes closing the range worth the risk of doing so.

The AI weighs a candidate move in this currency. The shot it offers and the enemy guns that would bear on it where it ends are both counted gun for gun at their bands, so a broadside exchange is judged as an exchange — an aggressive ship accepts being shot at to land a broadside, a defensive one will not — and the style's preferred range, the wind and terrain are added on the same scale. Distance sailed is worth next to nothing in itself: it only breaks ties between moves that are otherwise as good, so that a ship sails rather than dawdles. It is never allowed to outweigh a shot, a threat or a range the style cares about — an AI that mostly rewards itself for making way sails straight at full speed whatever the table looks like.

The AI uses gunnery in two ways when it chooses a move. It scores the pose a plan **ends** in by the broadsides bearing on enemies and the enemy broadsides bearing on it. And because the rulebook lets a ship fire *during* her move, it also scores the **best shot the move offers at any of its five steps** — the heaviest effective weight of metal any arc would bring to bear on any enemy, raking counted for more — so it never manoeuvres itself out of its own firing solution by turning a bearing broadside away from a target at point-blank range. Enemy ships are taken to stand where they were entered; the player has already moved them by the time the AI is asked. Whether that shot is then fired, and what it does, is the player's to resolve.

## AI unit "style"

Depending on its style, an AI controlled unit makes different decisions when it comes to move.

### Tacking

Scored on the turn it begins, a tack is always among the worst moves available: the ship is in irons, making no way, drifting to leeward. So an AI judges a tack by where it *ends* instead — the pose on the far tack, several turns and a drift downwind from here. What makes it worth the cost is finishing with a **broadside bearing on an enemy at short range**, worth more the closer it is and more again if it would rake. That reward is discounted for every turn the tack takes, ignored if the drift would put the ship on terrain, and matters far less to a defensive ship, which has no interest in closing.

An AI may of course still come about for the ordinary reasons any move is chosen — to close, or to get out from under an enemy's guns.

### Aggressive

An aggressive unit will always try to close an enemy to shoot it with its port or starboard broadside, or even to come **into contact** — bases within 20mm — where the rulebook lets ships grapple and board. Whether they do, and what comes of it, is the table's business: the app declares nothing and tracks no grapple. The player records the outcome that matters to the AI by setting a ship's status, immobilised for one held fast.

### Cautious

A cautious unit will try to keep enemies at a medium distance and shoot them with its port or starboard broadside. However, if it sees an opportunity to close the range in a way to have its broadside pointed at the bow or stern of an enemy, it will seize the opportunity.

### Defensive

A defensive unit will try to keep all enemies at the longest range possible, and away from their broadsides.

Since the table is infinite, there is no edge to stop a defensive unit sailing away for good. Instead it is held by a **disengagement leash**: beyond 1.5× the longest gun range either it or the nearest enemy brings to bear, extra distance buys nothing, and withdrawing further costs it. A defensive unit therefore opens the range to the edge of usefulness and holds station there; if it finds itself well outside the leash it works its way back in.

## Technologies

This program is web based, optimised for usage on a small tablet or a big smartphone. It is a full frontend app: the state of ongoing games lives in local storage, with no server-side storage or code.

Dropdowns use a custom control rather than a native `<select>`: a native one hands its popup to the OS, which on a phone or tablet is a sheet or a centred dialog rather than a list under the control — and inside a transformed or scroll-clipped container it can be anchored somewhere else entirely. The app's list opens against its trigger on every platform.

All table information is entered by hand — there is no photo capture. With no table edges to align to and terrain reduced to primitives, a photograph has nothing left to anchor.

### Google Drive sync

Local storage is the working copy; a Google Drive folder can optionally be its mirror. The app talks to Drive straight from the browser through Google Identity Services with an **OAuth client ID only** — no secret, no server, no Google SDK beyond the sign-in script. The client ID comes from the build (`VITE_GOOGLE_CLIENT_ID`) or is pasted into the app, which overrides it.

- The player picks **any folder of theirs** to sync into, browsing from My Drive in an in-app folder list (the Google Picker would need an API key on top of the client ID). Listing folders the app did not create needs the full `drive` scope, so that is the scope requested.
- The folder mirrors local storage's layout: `games.json` holds the game list, `game-<id>.json` each game's full state, and `ship-templates.json` the library of saved ships. Drive file ids are cached per name so a save is a single update call; a stale id falls back to listing the folder.
- **Every Save pushes** the open game and the list. Deleting a game deletes its file and rewrites the list, so it does not come back on the next load. Saving or removing a saved ship rewrites the library file. Local writes never wait on the network; sync runs one job at a time in the background and reports through a status badge.
- On a pull, a folder **with** a library file replaces the local saved ships; a folder **without** one keeps them and is given a copy, so ships saved before sync was set up are not lost. An empty library is never written when seeding.
- **On app load the folder replaces local state** — every local game not on Drive is removed. A folder holding nothing of the app's is the one exception: it leaves local state alone, since an empty Drive almost always means a fresh setup rather than a wish to wipe the device. Adopting such a folder from the settings dialog seeds it with the local games instead; adopting one that already has games replaces local state, after a confirmation when both sides have games.
- The token flow yields access tokens of about an hour and **no refresh token**, and a popup can only be opened from a click. So the last token is kept in local storage and used silently while valid; once it lapses the app shows a *sign in* control rather than attempting a popup on its own, and pushes the last saved state once the player has signed in again.

### The map

The battlefield view has no fixed extent to draw: it frames whatever is on the table (ships, their bases, terrain and any revealed tracks), rescaling as the action spreads out or closes up. The player can take over that view at any time — drag empty water to pan, scroll or pinch to zoom, or use the on-screen controls — and a **Fit** button hands it back to following the action automatically. Tapping a ship or a terrain piece opens a small panel with its reading and buttons to edit it, move it, make it the origin, or delete it; a ship's panel also carries a **heading control** — a point to port or starboard at a tap, or a slider — and, for an AI ship, a **style** dropdown, so a heading or a change of temper can be entered without opening the form. A ship can also be placed by tapping the water: the tap is read off as a bearing from the origin ship, rounded to the nearest of the 16 points and the nearest millimetre, and pre-fills the form. **Move** works the same way for anything already on the table — pick the ship or terrain piece, tap the water where it now lies, and it is re-entered at that bearing — which is the quick way to bring the table up to date turn by turn. The origin ship cannot be moved like this: she reads *origin* wherever she is, so there is nothing to read a tap against.

An AI ship's revealed order is drawn as a track from where she is to where the plan leaves her. Her bearing is measured to the base centre, but a model is walked along the table by its stern, so the track follows the **middle of her stern edge** and the marker at its end sits where the stern will be read off. A **solid** track means she is under way; a **dashed** one means she is making no way of her own and going where the wind takes her — in irons, or on a declared tack. Where a chunk ends in a turn the track jogs sideways through the pivot.

Each AI ship's **order card** gives the whole turn's move as the player will carry it out: how far she sails in total and how many points she turns — or, for a ship with no way on, that she is drifting and by how much — then the five chunks with each turn at the end of the chunk it belongs to, adding up to the same total. To check the model once it is moved, the card also gives her **final heading**, where she ends **relative to where she started** (`182 mm NNE of her start`), and her **bearing from the origin ship** once every order is carried out — measured from where the origin ship will then be: where she was entered if she is the player's (the player has already moved by the time orders are laid), or where her own order leaves her if she is the AI's.
