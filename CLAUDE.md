# Wargame AI

## Overview

This project is about creating an AI opponent for tabletop wargames. The user should be able to create games in which they define the terrain, positions of units, and some constraints about how units move and act. Then, at each turn they would indicate what actions they have taken with their own unit and ask the AI opponent what it wants to do with its own units. 

The very first version, for simplicity reasons, will focus on naval wargames. This has several advantages:

- the traversable terrain is flat
- any piece of non-open terrain on the table is impassable for the units

## The table is infinite

The game table has **no edges and no fixed dimensions**. Ships may sail arbitrarily far in any direction; nothing is ever clamped, and the movement algorithm has no notion of a boundary. In practice this mirrors how these games are played: when the action drifts off one side of the physical table, everything is simply slid back across it.

Because there is no fixed frame to measure from, **the first entity added to the game — unit or terrain piece — becomes the origin of all coordinates.** Its own position always reads (0, 0), *even after it moves*; every other unit and terrain piece is reported as an offset from it, in millimetres along the compass axes (e.g. `320mm E · 150mm S`). When the origin ship sails, every other reading shifts by the same amount in the opposite sense, which is exactly what a player measuring from that ship at the table would see.

Each entity has a **placement reference point** — the point those offsets measure to and from:

- **terrain**: the centre of the shape;
- **units**: the middle of the rear (stern) edge of the base, which is where a ruler is held against a model. `Unit.position` stores the base *centre* internally, derived from the stern point; changing a ship's orientation therefore pivots it about its stern.

Positions are stored in an arbitrary world frame (+x = East, +y = South) and converted to and from offsets for display and entry. Coordinates are freely negative.

The origin can be re-pointed at any entity from the unit/terrain panel. It is only reassigned automatically when the origin entity is **deleted** — a destroyed or surrendered ship is still a model on the table, so it remains a perfectly good reference point.

## End-user usage

- The user creates a game
- The user specifies the wind direction
- The user describes the terrain pieces. Each is a simplified primitive rather than a traced outline:
    - a shape: circle, ellipse or rectangle
    - its size (diameter, or width E–W and length N–S)
    - its rotation, for ellipses and rectangles
    - the position of its **centre**, as an offset from the origin
- The user can specify the different units on the table:
    - side (player or AI)
    - name
    - orientation
    - position of the **middle of the rear side of the base**, as an offset from the origin
    - rig: square (the default) or fore & aft, which shifts the in-irons/beating boundary
    - base footprint (width and length)
    - top speed on each point of sail, best to worst — quarter reaching, running, reaching, beating. In irons is not among them: head to wind a ship carries no way of her own and drifts instead, at her drift speed.
    - a speed multiplier scaling every one of those figures, so one number makes a ship faster or slower overall. It is **entered as a whole percentage** — 100% by default, less for a ship shortened down, more for one under full sail — and applied as the decimal it stands for, so 90% multiplies her speeds by 0.9. Percentages are typed rather than decimals because a field that reparses every keystroke cannot hold a half-typed decimal: `0.` is not yet a number, so it lands as 0 and the digits after the point never arrive.
    - if it's an AI unit, its gun layout (see firing below) and its initial "style": aggressive, cautious, defensive (this has an impact on movement decisions, see movement rules below)

Only AI ships carry a gun layout. The player rolls their own fire at the table, so entering one for a player ship would be data nobody reads; where the AI needs to judge how dangerous a player ship is, it falls back on its own ranges.
- The game can start
- During the game, the user can:
    - update position and orientation of any unit
    - mark a unit as being grappled by another one
    - mark a unit as destroyed or surrendered (in both cases cannot act at all anymore) or immobilised (can fire but not move)
    - ask the AI to suggest a movement for one of the AI units (see movement rules below)
    - change the "style" of an AI unit
    - re-anchor the coordinate system onto a different unit or terrain piece

## Movement rules

Units have a maximum and minimum movement range. Between these boundaries, they can move any distance, knowing that the next turn's min distance will be half of what they have moved this time. On a ship's very first turn there is no previous move to halve, so its minimum is **half of its maximum**.

A ship's maximum for a point of sail is the figure entered for it scaled by her speed multiplier, so that one decimal moves both ends of the range at once — a ship under full sail must commit to more way, not just be allowed more.

The minimum is measured against the ship's base maximum for its point of sail, so it is a fixed number for the turn. The maximum, by contrast, drops 5% per turn point spent (see below) — so a plan with more than 10 turn points pushes the ceiling below the floor, which simply means that plan is not legal.

The selected movement distance is split as evenly as possible in 5 chunks. The ship is allowed to turn port or starboard up to two times during the movement phase, at the end of a chunk. For instance it can move, turn, move, move, turn, move, move. 

Turning is done in "points", knowing that a full 360 degrees circle is divided into 32 points (so 1 point = 11.25 degrees). Each ship has a maximum number of points per game round it can turn.

A turn is made the way the model is turned on the table: the ship **pivots about the rear corner of its base on the side it turns to** — the stern-port corner for a turn to port, the stern-starboard corner for a turn to starboard. That corner stays put and the rest of the base swings round it, so a turn shifts the ship's centre sideways and a little forward as well as changing its heading. This applies to every turn, including the swings of a declared tack. The displacement of a pivot is not distance sailed: it does not count toward the next turn's minimum move. For instance a 4th rate ship can turn 6 points, so it could, during its movement phase, turn 2 points then 4 points, for a total of 6 points; or turn 6 points in one go. It can also turn less than the maximum allowed.

When deciding how many points the ship will turn, it's important to note that each point will reduce the max speed by 5%. The movement panel shows the current min and max, with the max updating live as turn points are added to the plan. For instance, if a ship is able to move maximum 100mm straight ahead, without turning, if it decides to turn 5 points (in one go or split into two turns), then its maximum speed becomes 75mm (to be split in 5 chunks of 15mm).

At the end of a movement phase, the new orientation of the ship, in relation to the wind, will dictate how fast it will be able to move next time. If we number the points in relation to the ship's bow from 0 (ship's bow) to 16 (ship's stern), symetrically left and right (so 90 degrees left and right are both numbered 8), we can qualify the following attitudes, depending from which direction the wind is blowing:

- points 0 to 5: the ship is "in irons", meanin the wind comes from ahead
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

Because turning up into the wind requires this procedure, an ordinary movement order that would leave a ship in irons is not legal and is never offered.

The player declares a tack with a single button, which fills in the whole movement plan for them.

## Firing and reloading

### Guns and range bands

An arc's armament is a list of **gun profiles** rather than a single range and gun count — a broadside is rarely uniform, with long guns on the gun deck and carronades above, each reaching its own distances. Every profile gives a name, a number of guns, and the outer edge of four bands: **close, medium, long, extreme**. A shot falls in the first band whose distance it is still within, and beyond extreme the guns do not reach at all.

Distance costs accuracy, and the bands carry a to-hit modifier for it: close ×1, medium ×0.54, long ×0.4, extreme ×0.07. So what a shot is really worth is its **effective weight of metal** — each gun counted at its own band's modifier. That, not a raw count of guns, is what the AI weighs every shot and every position by, and it is what makes closing the range worth the risk of doing so.

### When a ship fires

A ship fires one arc per turn, at one chunk of its movement where the arc bears on a target in range. Because the shot is taken *during* the move rather than at the end of it, an AI weighs each candidate move by the shot it would actually produce — otherwise it can manoeuvre itself out of its own firing solution, turning a bearing broadside away from a target at point-blank range.

*Which* chunk is a real decision rather than a matter of taking the first thing that bears: the same broadside is worth fourteen times as much alongside as at extreme range, and a raking shot more again. So an AI takes the heaviest shot the turn offers, and the earliest of equals — firing early also means the arc is loaded again early next turn.

It may also decline to fire. A shot at extreme range is barely worth the powder, so while the move is still closing on that target the guns are better kept loaded; a ship that will get no nearer fires what she has.

Reloading is tracked **per arc**, not per ship. An arc that fired on chunk N is loaded again on chunk N of the following turn — a full turn's work. The other arcs are unaffected: a starboard broadside fired on chunk 2 leaves the port guns free to fire from chunk 1. Any arc that does not fire during a turn is loaded by the next one.

## AI unit "style"

Depending on its style, an AI controlled unit would make different decisions when it comes to move.

### Tacking

Scored on the turn it begins, a tack is always among the worst moves available: the ship is in irons, making no way, drifting to leeward. So an AI judges a tack by where it *ends* instead — the pose on the far tack, several turns and a drift downwind from here. What makes it worth the cost is finishing with a **broadside bearing on an enemy at short range**, worth more the closer it is and more again if it would rake. That reward is discounted for every turn the tack takes, ignored if the drift would put the ship on terrain, and matters far less to a defensive ship, which has no interest in closing.

An AI may of course still come about for the ordinary reasons any move is chosen — to close, or to get out from under an enemy's guns.

### Aggressive

An aggressive unit will always try to go close an ennemy to shoot it with its port or starboard broadside, or even decide to come into contact (or less than 20mm away) to grapple it. If already grappled, it will go for a boarding action. 

### Cautious

A cautious unit will try to keep ennemies at a medium distance and shoot them with its port or starboard broadside. However, if it sees an opportunity to close the range in a way to have its broadside pointed at the bow or stern of an ennemy, it will seize the opportunity. 

### Defensive

A defensive unit will try to keep all ennemies at the longest range possible, and away from their broadsides.

Since the table is infinite, there is no edge to stop a defensive unit sailing away for good. Instead it is held by a **disengagement leash**: beyond 1.5× the longest gun range either it or the nearest enemy brings to bear, extra distance buys nothing, and withdrawing further costs it. A defensive unit therefore opens the range to the edge of usefulness and holds station there; if it finds itself well outside the leash it works its way back in.

## Technologies

This program should be web based, optimised for usage on a small tablet or a big smartphone.

Dropdowns use a custom control rather than a native `<select>`: a native one hands its popup to the OS, which on a phone or tablet is a sheet or a centred dialog rather than a list under the control — and inside a transformed or scroll-clipped container it can be anchored somewhere else entirely. The app's list opens against its trigger on every platform. It should store the state of ongoing games in local storage, not needing any server side storage or app code. It should be a full frontend app.

All table information is entered by hand — there is no photo capture. With no table edges to align to and terrain reduced to primitives, a photograph has nothing left to anchor, so the setup flow is wind direction followed by typed terrain and unit descriptions.

A ship's planned move is drawn on the map as a track from where she is to where she will be. The track follows her **placement reference point** — the middle of the stern edge — rather than the base centre, so what is drawn is the path of the very point a player measures the model by, and the marker at its end sits exactly where the stern will be read off. A **solid** track means she is under way; a **dashed** one means she is making no way of her own and going where the wind takes her — in irons, or on a declared tack. Where a chunk ends in a turn the track jogs sideways through the pivot.

Once the AI's orders are revealed, a **chunk slider** under the map scrubs the turn: the ships are drawn where they will stand at the end of the selected chunk (1 to 5, defaulting to 5, the end of the turn), and the panel lists every ship's stern position and heading for that chunk. Positions are measured from the origin entity *as it stands at that chunk*, which is what a player walking the models along the table measures against.

The battlefield view has no fixed extent to draw: it frames whatever is currently in play (ships, their bases, terrain and previewed movement paths), rescaling as the action spreads out or closes up. The player can take over that view at any time — drag empty water to pan, scroll or pinch to zoom, or use the on-screen controls — and a **Fit** button hands it back to following the action automatically. 