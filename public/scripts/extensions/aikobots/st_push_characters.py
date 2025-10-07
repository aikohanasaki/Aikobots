#!/usr/bin/env python3
import os
import shutil
import sys
import subprocess
import json
from st_config import (
    REQUIRE_ROOT,
)

def check_root():
    # Check if script is run with sudo permissions
    if REQUIRE_ROOT and os.geteuid() != 0:
        print("Please run as root or with sudo")
        sys.exit(1)

# Path to Node.js tools directory (update as needed)
NODE_TOOLS_DIR = "/home/aiko/SillyTavern-Launcher/SillyTavern/public/scripts/extensions/aikobots"

def read_favorite(png_path):
    node_script = os.path.join(NODE_TOOLS_DIR, "read_favorite.js")
    if not os.path.exists(png_path):
        # No file to read, treat as not favorite
        return False
    try:
        result = subprocess.run(
            ["node", node_script, png_path],
            capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)
        # Prefer nested extension, fallback to flat
        return bool(data.get("extensions_fav", False)) or bool(data.get("fav", False))
    except subprocess.CalledProcessError as e:
        if "No PNG metadata" in e.stderr or "Could not parse PNG" in e.stderr or e.returncode == 1:
            print(f"Info: PNG at {png_path} is missing SillyTavern metadata (not an error for new files).")
            return False
        print(f"Warning: Could not read favorite status from {png_path}: {e.stderr.strip()}")
        return False
    except Exception as e:
        print(f"Warning: Could not read favorite status from {png_path}: {e}")
def copy_and_preserve_favorite(source_file, dest_file):
    """
    If dest_file does NOT exist: copy, then set favorite to False.
    If dest_file DOES exist: read and save favorite, copy (overwrite), then restore favorite.
    """
    if not os.path.isfile(source_file):
        print(f"Source file does not exist: {source_file}")
        return

    if not os.path.exists(dest_file):
        shutil.copy2(source_file, dest_file)
        set_favorite(dest_file, False)
        print(f"Copied {source_file} -> {dest_file} (favorite set to False)")
    else:
        orig_favorite = read_favorite(dest_file)
        shutil.copy2(source_file, dest_file)
        set_favorite(dest_file, orig_favorite)
        print(f"Copied {source_file} -> {dest_file} (favorite preserved: {orig_favorite})")

def main():
    # Check for root permissions
    check_root()
    
    # Base directories
    DATA_DIR="/home/aiko/SillyTavern-Launcher/SillyTavern/data"
    DEFAULT_CONTENT_DIR="/home/aiko/SillyTavern-Launcher/SillyTavern/default/content"
    
    # Format: (source_user, filename)
    CHARACTERS_TO_COPY = [
         ("default-user", "Caleb.png"),
         ("echomeria", "Caesar.png"),
         ("ravenh", "Ryker.png"),
    ]
    
    # Make sure destination directories exist
    os.makedirs(os.path.join(DEFAULT_CONTENT_DIR, "characters"), exist_ok=True)
    
    # Get all user directories except Z-Worlds and those starting with underscore
    user_dirs = []
    for item in os.listdir(DATA_DIR):
        path = os.path.join(DATA_DIR, item)
        if (os.path.isdir(path) and 
            path != DATA_DIR and 
            os.path.basename(path) != "Z-Worlds" and
            not os.path.basename(path).startswith("_")):
            user_dirs.append(path)
    
    print("Found the following user directories:")
    for dir in user_dirs:
        print(dir)
    print("-----------------------")
    
    # Copy character files to all user directories and default content
    for source_user, character in CHARACTERS_TO_COPY:
        # Construct source file path
        source_user_dir = os.path.join(DATA_DIR, source_user)
        source_file = os.path.join(source_user_dir, "characters", character)
        
        if os.path.isfile(source_file):
            print(f"Copying character file: {character} from {source_user}")
            
            # Copy to default content directory with favorite logic
            dest_file = os.path.join(DEFAULT_CONTENT_DIR, "characters", character)
            if os.path.realpath(source_file) != os.path.realpath(dest_file):
                copy_and_preserve_favorite(source_file, dest_file)
            else:
                print(f"Skipped (same file): {source_file} -> {dest_file}")
            
            # Copy to all other user directories (excluding the source directory)
            for user_dir in user_dirs:
                if os.path.realpath(user_dir) == os.path.realpath(source_user_dir):
                    print(f"Skipping source directory: {user_dir}")
                    continue
                    
                target_dir = os.path.join(user_dir, "characters")
                if os.path.islink(target_dir):
                    print(f"Skipping symlinked directory: {target_dir}")
                    continue
                else:
                    os.makedirs(target_dir, exist_ok=True)
                    dest_file = os.path.join(target_dir, character)
                    if os.path.realpath(source_file) != os.path.realpath(dest_file):
                        copy_and_preserve_favorite(source_file, dest_file)
                    else:
                        print(f"Skipped (same file): {source_file} -> {dest_file}")
        else:
            print(f"Warning: Source character file not found: {source_file}")
    
    print("-----------------------")
    print("Copy operation completed")

if __name__ == "__main__":
    main()
