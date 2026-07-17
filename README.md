# Monster Mayhem

Concurrent Systems Assignment

*Student:* Natalia Gomes Fernandes

## Project Overview

Monster Mayhem is a web-based multiplayer board game developed with Node.js and Socket.IO.

The game is played on a 10×10 board where two players place and move monsters according to the assignment rules. The server keeps the game state updated and synchronizes both players using Socket.IO.

---

## Features

- Two-player online game
- 10×10 game board
- Three monster types:
  - Vampire
  - Werewolf
  - Ghost
- Real-time synchronization using Socket.IO
- Turn-based gameplay
- Automatic round progression
- Monster movement validation
- Battle resolution
- Player elimination
- Winner detection
- Persistent player statistics
- Server-wide games played counter
- Mutex implementation to prevent concurrent game state updates.

---

## Technologies Used

- Node.js
- Express.js
- Socket.IO
- HTML
- CSS
- JavaScript

---

## Installation

Clone the repository:

bash
git clone https://github.com/natalia248/monster-mayhem-concurrent-systems.git


Go to the project folder:

bash
cd monster-mayhem-concurrent-systems


Install dependencies:

bash
npm install


---

## Running the project

Start the server:

bash
npm start


Open your browser:


http://localhost:3000


Open a second browser window or another browser to connect the second player.

---

## Game Rules

Each player owns one edge of the board.

During a turn a player may:

- Place one monster on their edge.
- Move each existing monster once.
- End their turn.

Monsters move according to the assignment rules, and all interactions are handled by the server.

---

## Persistent Statistics

Player statistics are stored in:


data/stats.json


Statistics include:

- Total games played
- Wins
- Losses

These values remain available after restarting the server.

---

## Project Structure


monster-mayhem-concurrent-systems/
│
├── data/
│   └── stats.json
│
├── public/
│   ├── client.js
│   ├── index.html
│   └── style.css
│
├── server/
│   ├── Game.js
│   ├── GameManager.js
│   ├── Mutex.js
│   ├── index.js
│   └── statsStore.js
│
├── package.json
└── README.md


---

## Notes

This project was developed as part of the Concurrent Systems module.

## Author

Natalia Gomes Fernandes