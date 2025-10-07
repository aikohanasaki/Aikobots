// Usage: node set_favorite.js <path/to/character.png> <true|false>
// Sets both fav and data.extensions.fav fields in the PNG metadata

import fs from "fs";
import { read, write } from "../../../../src/character-card-parser.js";

if (process.argv.length < 4) {
    console.error("Usage: node set_favorite.js <path/to/character.png> <true|false>");
    process.exit(1);
}

const filePath = process.argv[2];
const favValue = process.argv[3] === "true";

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

// Update favorite fields
char.fav = favValue;
if (char.data && char.data.extensions) {
    char.data.extensions.fav = favValue;
}

const updatedJson = JSON.stringify(char);

let newBuffer;
try {
    newBuffer = write(buffer, updatedJson);
} catch (e) {
    console.error("Could not write new PNG metadata:", e);
    process.exit(4);
}

try {
    fs.writeFileSync(filePath, newBuffer);
    console.log(`Favorite fields set to ${favValue} for: ${filePath}`);
} catch (e) {
    console.error("Could not save file:", filePath);
    process.exit(5);
}
