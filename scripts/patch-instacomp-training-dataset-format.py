#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/app/training.py")
source = path.read_text(encoding="utf-8")
old = '''    return {
        "id": example.training_example_id,
        "images": images,
        "messages": [
            {"role": "user", "content": _training_prompt(example)},
            {"role": "assistant", "content": _training_answer(example)},
        ],
        "metadata": {
'''
new = '''    return {
        "id": example.training_example_id,
        "images": images,
        "messages": [
            {
                "role": "user",
                "content": [
                    *[
                        {"type": "image", "image": image_path}
                        for image_path in images
                    ],
                    {"type": "text", "text": _training_prompt(example)},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": _training_answer(example)}
                ],
            },
        ],
        "metadata": {
'''
if source.count(old) != 1:
    raise SystemExit("training.py dataset-row contract changed unexpectedly")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
