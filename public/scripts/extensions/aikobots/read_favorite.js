// Usage: node read_favorite.js <path/to/character.png>
// Prints the favorite status (true/false) for both fav and data.extensions.fav

import fs from "fs";
import { read } from "../../../../src/character-card-parser.js";

if (process.argv.length < 3) {
    console.error("Usage: node read_favorite.js <path/to/character.png>");
    process.exit(1);
}

const filePath = process.argv[2];
let buffer;
try {
    buffer = fs.readFileSync(filePath);
} catch (e) {
    console.error("Could not read file:", filePath);
    process.exit(2);
}

let char;
try {
    const jsonString = read(buffer);
    char = JSON.parse(jsonString);
} catch (e) {
    console.error("Could not parse PNG character data:", e);
    process.exit(3);
}

const fav = char.fav === true;
const ext_fav = char.data && char.data.extensions && char.data.extensions.fav === true;
console.log(JSON.stringify({
    fav,
    extensions_fav: ext_fav
}));
