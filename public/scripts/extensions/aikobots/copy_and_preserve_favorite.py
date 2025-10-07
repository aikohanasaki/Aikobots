import os
import shutil
import subprocess
import json

def read_favorite(png_path):
    node_script = os.path.join(os.path.dirname(__file__), "read_favorite.js")
    try:
        result = subprocess.run(
            ["node", node_script, png_path],
            capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)
        # Prefer nested extension, fallback to flat
        return bool(data.get("extensions_fav", False)) or bool(data.get("fav", False))
    except Exception as e:
        print(f"Warning: Could not read favorite status from {png_path}: {e}")
        return False

def set_favorite(png_path, value):
    node_script = os.path.join(os.path.dirname(__file__), "set_favorite.js")
    subprocess.run(
        ["node", node_script, png_path, str(value).lower()],
        capture_output=True, text=True
    )

def copy_and_preserve_favorite(source_file, dest_file):
    """
    If dest_file does NOT exist: copy, then set favorite to False.
    If dest_file DOES exist: read and save favorite, copy (overwrite), then restore favorite.
    """
    if not os.path.isfile(source_file):
        print(f"Source file does not exist: {source_file}")
        return

    if not os.path.exists(dest_file):
        # Simple copy, then set favorite off
        shutil.copy2(source_file, dest_file)
        set_favorite(dest_file, False)
        print(f"Copied {source_file} -> {dest_file} (favorite set to False)")
    else:
        # Read favorite, copy (overwrite), then restore favorite
        orig_favorite = read_favorite(dest_file)
        shutil.copy2(source_file, dest_file)
        set_favorite(dest_file, orig_favorite)
        print(f"Copied {source_file} -> {dest_file} (favorite preserved: {orig_favorite})")
