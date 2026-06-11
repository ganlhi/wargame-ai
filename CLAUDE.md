# Wargame AI

## Overview

This project is about creating an AI opponent for tabletop wargames. The user should be able to create games in which they define the size of the table, positions of units, some constraints about how units move and act. Then, at each turn they would indicate what actions they have taken with their own unit and ask the AI opponent what it wants to do with its own units. 

The very first version, for simplicity reasons, will focus on naval wargames. This has several advantages:

- the traversable terrain is flat
- any piece of non-open terrain on the table is impassable for the units

## End-user usage

- The user creates a game
- They take a picture of the table with terrain on it, from above, and the picture is automatically undistoted to be a perfect rectangle
- The software tries to automatically detect the terrain pieces and their contour, but let the user correct those, or add missing ones, or delete incorrect ones
- The user can specify the wind direction
- The user can specify the different units on the table: 
    - side (player or AI)
    - name
    - orientation
    - position
    - maximum firing range for each firing arc
    - if it's an AI unit, its initial "style": aggressive, cautious, defensive (this has an impact on movement decisions, see movement rules below)
- The game can start
- During the game, the user can:
    - update position and orientation of any unit
    - mark a unit as being grappled by another one
    - mark a unit as destroyed or surrendered (in both cases cannot act at all anymore) or immobilised (can fire but not move)
    - ask the AI to suggest a movement for one of the AI units (see movement rules below)
    - change the "style" of an AI unit

## Movement rules

Units have a maximum and minimum movement range. Between these boundaries, they can move any distance, knowing that the next turn's min distance will be half of what they have moved this time.

The selected movement distance is split as evenly as possible in 5 chunks. The ship is allowed to turn port or starboard up to two times during the movement phase, at the end of a chunk. For instance it can move, turn, move, move, turn, move, move. 

Turning is done in "points", knowing that a full 360 degrees circle is divided into 32 points (so 1 point = 11.25 degrees). Each ship has a maximum number of points per game round it can turn. For instance a 4th rate ship can turn 6 points, so it could, during its movement phase, turn 2 points then 4 points, for a total of 6 points; or turn 6 points in one go. It can also turn less than the maximum allowed.

When deciding how many points the ship will turn, it's important to note that each point will reduce the max speed by 5%. For instance, if a ship is able to move maximum 100mm straight ahead, without turning, if it decides to turn 5 points (in one go or split into two turns), then its maximum speed becomes 75mm (to be split in 5 chunks of 15mm).

At the end of a movement phase, the new orientation of the ship, in relation to the wind, will dictate how fast it will be able to move next time. If we number the points in relation to the ship's bow from 0 (ship's bow) to 16 (ship's stern), symetrically left and right (so 90 degrees left and right are both numbered 8), we can qualify the following attitudes, depending from which direction the wind is blowing:

- points 0 to 4: the ship is "in irons", meanin the wind comes from ahead
- points 5 to 7: the ship is "beating"
- points 8 to 9: the ship is "reaching"
- points 10 to 13: the ship is "quarter reaching"
- points 14 to 16: the ship is "running"

For most ships, the best to worst attitudes are as follows: quarter reaching, running, reaching, beating, in irons.

There is a special rule about going volontarily in irons: if a ship has spent the previous turn entirely beating, it can turn into the wind (so going "in irons") using as many turn points as possible, and keep turning in the same direction the following game rounds, until it's beating again on the other side. All the time it's in irons, it will not move forward, but instead drift in the direction of the wind. 

## AI unit "style"

Depending on its style, an AI controlled unit would make different decisions when it comes to move.

### Aggressive

An aggressive unit will always try to go close an ennemy to shoot it with its port or starboard broadside, or even decide to come into contact (or less than 20mm away) to grapple it. If already grappled, it will go for a boarding action. 

### Cautious

A cautious unit will try to keep ennemies at a medium distance and shoot them with its port or starboard broadside. However, if it sees an opportunity to close the range in a way to have its broadside pointed at the bow or stern of an ennemy, it will seize the opportunity. 

### Defensive

A defensive unit will try to keep all ennemies at the longest range possible, and away from their broadsides (without leaving the table, though).

## Technologies

This program should be web based, optimised for usage on a small tablet or a big smartphone, using the device's camera to capture the image of the table. It should store the state of ongoing games in local storage, not needing any server side storage or app code. It should be a full frontend app. 