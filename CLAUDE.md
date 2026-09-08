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
    - maximum firing range for each firing arc
    - if it's an AI unit, its initial "style": aggressive, cautious, defensive (this has an impact on movement decisions, see movement rules below)
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

The minimum is measured against the ship's base maximum for its point of sail, so it is a fixed number for the turn. The maximum, by contrast, drops 5% per turn point spent (see below) — so a plan with more than 10 turn points pushes the ceiling below the floor, which simply means that plan is not legal.

The selected movement distance is split as evenly as possible in 5 chunks. The ship is allowed to turn port or starboard up to two times during the movement phase, at the end of a chunk. For instance it can move, turn, move, move, turn, move, move. 

Turning is done in "points", knowing that a full 360 degrees circle is divided into 32 points (so 1 point = 11.25 degrees). Each ship has a maximum number of points per game round it can turn. For instance a 4th rate ship can turn 6 points, so it could, during its movement phase, turn 2 points then 4 points, for a total of 6 points; or turn 6 points in one go. It can also turn less than the maximum allowed.

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

There is a special rule about going volontarily in irons: if a ship has spent the previous turn entirely beating, it can turn into the wind (so going "in irons") using as many turn points as possible, and keep turning in the same direction the following game rounds, until it's beating again on the other side. All the time it's in irons, it will not move forward, but instead drift in the direction of the wind — that is, straight downwind: 16 points from the direction the wind blows from, never across it. 

## AI unit "style"

Depending on its style, an AI controlled unit would make different decisions when it comes to move.

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

The battlefield view has no fixed extent to draw: it frames whatever is currently in play (ships, their bases, terrain and previewed movement paths), rescaling as the action spreads out or closes up. The player can take over that view at any time — drag empty water to pan, scroll or pinch to zoom, or use the on-screen controls — and a **Fit** button hands it back to following the action automatically. 